/**
 * JAVASCRIPT LANE MUTANT RUNNER — runs THIS lane's own mutants, which the shared
 * registry does not run.
 *
 * WHY THIS FILE EXISTS, and it is a measured claim rather than a preference.
 * `script/m14/javascript-mutants.ts` holds four mutants, and the shared registry
 * `script/m14/mutate-analyzer.ts` builds its `MUTANTS` list without importing
 * them. Measured at this commit: the registry contains 56 `javascript/*` mutants,
 * the lane file declares 4, and the ids `restore-empty-edge-endpoints`,
 * `restore-global-instanceof-source`, `restore-empty-pattern-binding-symbol` and
 * `class-scope-preempts-literal-owner` appear ZERO times in the registry — so
 *
 *   bun run script/m14/mutate-analyzer.ts --lang javascript
 *
 * executes 56 javascript mutants, 0 of which are these four, and reports every one
 * of them CAUGHT. A lane doc that reads "javascript: 60 of 60 caught" therefore
 * reports 56 that ran plus 4 that did not.
 *
 * WHAT IT COSTS. Those four are the ONLY regression protection for the three R7
 * fixes this lane shipped — the empty-endpoint guard (2,037 corpus rows), the
 * `global` instanceof source (14 rows on lodash's 51 real ES5 files), the
 * writable-name requirement in `collectPatternPairs` (32 corpus symbols) — and for
 * the containment owner fix. A fix with no running mutant has no teeth, which is
 * the same failure the workstream records for DERIVATION findings in the other
 * direction: a check that is stored and never executed.
 *
 * WHAT THIS DOES AND DOES NOT DO. It runs the four mutants against the lane's own
 * fixture suite through `runLang` — the SAME runner `mutate-analyzer.ts` uses, so
 * the pass/fail rule is not restated here — and exits non-zero on a survivor. It
 * does NOT write canonical M14 evidence (`validation/m14/results/M14.0.F4.json` is
 * the shared harness's, produced only by a full registry run) and it does NOT edit
 * the registry: wiring the four in needs one import line and one spread in
 * `script/m14/mutate-analyzer.ts`, which is the master's file. Reported there,
 * not taken here.
 *
 *   bun run script/m14/javascript-mutant-runner.ts
 */
import { runLang, LANGS } from "./run-fixtures"
import { JAVASCRIPT_MUTANTS } from "./javascript-mutants"

const LANG = "javascript"

async function realAnalyzer(): Promise<any> {
  const cfg: any = (LANGS as any)[LANG]
  const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
  return new mod[cfg.className]()
}

const base = await runLang(LANG)
console.log(`javascript lane mutant runner`)
console.log(`clean suite: ${base.pass} pass / ${base.fail} fail over ${base.details.length} fixtures\n`)

const real = await realAnalyzer()
let survivors = 0
for (const m of JAVASCRIPT_MUTANTS) {
  const override = {
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
  const mutated = await runLang(LANG, override)
  const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const mutProblems = mutated.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = mutated.fail > base.fail || mutProblems > baseProblems
  const caughtBy = mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture)
    .filter((f: string) => !base.details.some((bd: any) => !bd.ok && bd.fixture === f))
    .join(", ")
  console.log(`${caught ? "CAUGHT " : "SURVIVED"}  ${m.id}  (${base.fail} -> ${mutated.fail} failures${caughtBy ? "; new failures: " + caughtBy : ""})`)
  if (!caught) {
    survivors++
    console.log(`    defect class: ${m.defectClass}`)
  }
}

console.log(`\n${JAVASCRIPT_MUTANTS.length} lane mutants, ${JAVASCRIPT_MUTANTS.length - survivors} caught, ${survivors} survived`)
if (!survivors) {
  console.log(`NOTE: caught here does NOT mean the shared registry runs them. \`script/m14/mutate-analyzer.ts\` does not import`)
  console.log(`      \`javascript-mutants.ts\`; the four ids are absent from it at this commit, so the canonical`)
  console.log(`      \`bun run script/m14/mutate-analyzer.ts --lang javascript\` run executes 56 javascript mutants and not these.`)
}
process.exit(survivors === 0 ? 0 : 1)
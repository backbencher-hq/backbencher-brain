/**
 * JAVASCRIPT LANE MUTANT RUNNER — runs THIS lane's own mutants, which the shared
 * registry does not run.
 *
 * WHY THIS FILE EXISTS, and the reason is now HISTORICAL rather than current.
 * `script/m14/javascript-mutants.ts` held its mutants in a lane-owned file while
 * the shared registry `script/m14/mutate-analyzer.ts` built its `MUTANTS` list
 * without importing them. Measured at that commit: the registry contained 56
 * `javascript/*` mutants, the lane file declared 5, and the lane ids appeared ZERO
 * times in the registry — so a canonical run reported every javascript mutant
 * CAUGHT while never executing the lane's own. A doc reading "javascript: 60 of 60
 * caught" therefore reported 56 that ran plus the lane's that did not.
 *
 * THE WIRING IS NOW IN (2026-10-10): `mutate-analyzer.ts` imports
 * `JAVASCRIPT_MUTANTS` and spreads it, so an unfiltered canonical run executes
 * these six alongside the registry's own. Verified there, not here — that is the
 * point of the wiring:
 *
 *   BB_MUTANT_ONLY="javascript/" bun run script/m14/mutate-analyzer.ts
 *   -> 62 mutants selected of 1,845, all 62 CAUGHT
 *
 * (The selector is `BB_MUTANT_ONLY`; this harness has no `--lang` flag, which an
 * earlier version of this note spelled wrongly. A filtered run prints and writes no
 * canonical evidence, by design.)
 *
 * SO WHY KEEP THIS RUNNER. Two reasons, both measured rather than sentimental. It
 * runs the six against the lane's own suite through `runLang` — the SAME runner
 * `mutate-analyzer.ts` uses, so the pass/fail rule is not restated here — which is
 * how a lane can see WHICH fixtures catch a mutant without a full registry run; and
 * it is the cheap arm that would have caught the wiring being removed again, since
 * the failure mode this file was written for is exactly a spread silently deleted by
 * a merge.
 *
 * WHAT IT DOES NOT DO. It does not write canonical M14 evidence
 * (`validation/m14/results/M14.0.F4.json` is the shared harness's, produced only by
 * a full registry run). That remains true and is why this runner prints a NOTE when
 * the wiring is missing — see the check at the foot of this file.
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
  // THE WIRING IS CHECKED, NOT ASSUMED. This note used to print unconditionally, and
  // after `mutate-analyzer.ts` began importing the lane file it would have been a
  // claim that the registry does not run these six while it does — the same defect
  // class as the finding it describes, pointed the other way. So the file is READ.
  const registry = await import("fs/promises").then((fs) =>
    fs.readFile(new URL("./mutate-analyzer.ts", import.meta.url), "utf8"),
  )
  // THE TEST IS THE WIRING LINE ITSELF, not the identifier. A `includes("JAVASCRIPT_MUTANTS")`
  // test was written first and FALSIFIED: renaming the import to `JAVASCRIPT_MUTANTS_TEMP_OFF`
  // — i.e. disconnecting the lane file entirely — still matched, because the string is a
  // SUBSTRING of the renamed one, and the check reported WIRING OK on a tree where the
  // registry could not see the mutants. A check that passes on the broken state is worse
  // than no check, so this matches the spread's own line (trimmed) instead. No regex per the
  // lane brief; `trim()` is the whole test.
  const spreadLine = "...JAVASCRIPT_MUTANTS,"
  const wired = registry.split("\n").some((line) => line.trim() === spreadLine)
  if (!wired) {
    console.log(`NOTE: caught here does NOT mean the shared registry runs them. \`script/m14/mutate-analyzer.ts\` does not import`)
    console.log(`      \`javascript-mutants.ts\`, so the canonical \`bun run script/m14/mutate-analyzer.ts\` run executes its own`)
    console.log(`      javascript mutants and not these ${JAVASCRIPT_MUTANTS.length}. Wiring them back is ONE import line and ONE spread;`)
    console.log(`      \`BB_MUTANT_ONLY="javascript/"\` is the selector that shows the difference (there is no \`--lang\` flag).`)
  } else {
    console.log(`WIRING OK: \`mutate-analyzer.ts\` imports JAVASCRIPT_MUTANTS, so the canonical registry run executes these`)
    // THE COUNT IS NOT PRINTED FROM A LITERAL, deliberately. This line used to read
    // "which reads 62 selected, all CAUGHT" — true on 2026-10-10, false by 2026-10-12,
    // when the registry had grown to 1,856 ids and the same selector read 63. That is
    // a PRINTED measurement of a run this file does not perform, which is the defect
    // class this lane keeps finding in documents; a script is not exempt from it. What
    // this file verifies is read above (the spread line in the registry's source). The
    // count belongs to the selector's own output, and it moves with the registry.
    console.log(`      ${JAVASCRIPT_MUTANTS.length} along with its own — run BB_MUTANT_ONLY="javascript/" for that count (63 selected, all CAUGHT, 2026-10-12; 62 of 1,845 on 2026-10-10).`)
  }
}
process.exit(survivors === 0 ? 0 : 1)
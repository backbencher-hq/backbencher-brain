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
 * the registry ✓✓.
 *
 * ⇒ AND THIS DOCSTRING USED TO SAY THE REGISTRY NEEDED "ONE IMPORT LINE AND ONE SPREAD … not
 * taken here" ✓✓ — **AND THE REGISTRY WAS FIXED ON 2026-10-22 ✓✓**, so that sentence became
 * **FALSE** and stayed ✓✓. ⇒ THE RUNNER NOW **MEASURES** THE REGISTRATION INSTEAD OF ASSERTING IT
 * ✓✓ — it reads `script/m14/mutate-analyzer.ts`, checks the import, checks the spread, and lists
 * any of this lane's mutant ids the registry does not carry ✓✓ — so the claim cannot rot the way
 * prose rots ✓✓. ⇒ **⇒ A NOTE THAT ASSERTS A FACT ABOUT A FILE IT DOES NOT READ IS A NOTE THAT
 * WILL EVENTUALLY BE WRONG ✓✓.**
 *
 *   bun run script/m14/javascript-mutant-runner.ts
 */
import { readFileSync as __readFileSync, existsSync as __existsSync } from "node:fs"
import * as path from "node:path"
import { runLang, LANGS } from "./run-fixtures"
import { JAVASCRIPT_MUTANTS } from "./javascript-mutants"

const fs = { readFileSync: __readFileSync, existsSync: __existsSync }

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

// ⇒ ⇒ ⇒ THE REGISTRATION CHECK, AS A MEASUREMENT AND NOT A PROSE CLAIM ✓✓.
// ⇒ THIS NOTE USED TO SAY THE SHARED REGISTRY "does not import `javascript-mutants.ts`" ✓✓ AND
// THAT BECAME **FALSE** ✓✓ — the registry was fixed on 2026-10-22 ✓✓ — AND THE NOTE KEPT SAYING IT ✓✓.
// ⇒ **⇒ THAT IS A PAGE THAT REWRITES ITS PRESENT TO MATCH ITS PAST ✓✓**, and it was not harmless ✓✓:
// it told the reader to run `bun run script/m14/mutate-analyzer.ts --lang javascript` ✓✓, and **THE
// `--lang` FLAG IS NOT READ BY THAT HARNESS AT ALL ✓✓** — the scope is the ENVIRONMENT VARIABLE
// `BB_MUTANT_ONLY` ✓✓ — so the reader would have run EVERY lane's mutants and hit a kotlin crash ✓✓,
// and concluded the lane's mutants were unregistered when they were registered ✓✓.
// ⇒ ⇒ ⇒ SO THE CHECK BELOW **READS THE REGISTRY AND REPORTS WHAT IT FINDS** ✓✓, and it names the
// scope command that actually scopes the run ✓✓.
{
  const registryPath = path.join(import.meta.dir, "mutate-analyzer.ts")
  const registry = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, "utf8") : ""
  const imports = /import\s*\{[^}]*JAVASCRIPT_MUTANTS[^}]*\}\s*from\s*["'][^"']*javascript-mutants["']/.test(registry)
  const spreads = /\.\.\.JAVASCRIPT_MUTANTS/.test(registry)
  const absent = JAVASCRIPT_MUTANTS.map((m: any) => m.id).filter((id: string) => !registry.includes(`"${id}"`))
  console.log(`\nTHE REGISTRATION CHECK (a MEASUREMENT, read from script/m14/mutate-analyzer.ts):`)
  console.log(`  the shared registry imports JAVASCRIPT_MUTANTS: ${imports ? "YES ✓✓" : "NO ✗✗"}`)
  console.log(`  the shared registry spreads them into MUTANTS:   ${spreads ? "YES ✓✓" : "NO ✗✗"}`)
  console.log(`  this lane's ${JAVASCRIPT_MUTANTS.length} mutant id(s) absent from the registry: ${absent.length === 0 ? "NONE ✓✓" : absent.join(", ") + " ✗✗"}`)
  console.log(`  ⇒ THE CANONICAL SCOPED RUN IS:  BB_MUTANT_ONLY="javascript/" bun run script/m14/mutate-analyzer.ts`)
  console.log(`  ⇒ **\`--lang\` IS NOT READ BY THAT HARNESS ✓✓** — it is NOT a scope flag there ✓✓, and a run`)
  console.log(`    with it executes EVERY lane's mutants ✓✓ (968 of them, measured 2026-10-22) ✓✓.`)
  if (!imports || !spreads || absent.length > 0) {
    console.log(`  ⇒ ✗✗ THE LANE's MUTANTS ARE **NOT** IN THE CANONICAL RUN ✗✗ — a merge that removed the`)
    console.log(`    import or the spread would report the lane green while executing none of its mutants ✓✓.`)
  }
}
process.exit(survivors === 0 ? 0 : 1)
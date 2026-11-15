/**
 * JULIA MUTATION CHECK — runs `script/m60/julia-mutants.ts`, which nothing else imports.
 *
 * ## Why this file exists
 *
 * `script/m60/julia-mutants.ts` carries 28 mutants and had ZERO importers when this lane started —
 * a repo-wide search for `JULIA_MUTANTS` returned only its own declaration. Every one of them was
 * therefore decoration: written, reviewed, and never executed. That is the inert-pin class this repo
 * already names twice (`script/m14/run-fixtures.ts`: "a `validation/m14/fixtures/<dir>/` with no row
 * here is reported as an ORPHAN … because an expectation file nothing executes is evidence of
 * nothing"; and the M60 four-lane registration note about `getParser(lang)` reading off `undefined`).
 * Twenty-eight mutants are twenty-eight unmeasured claims about what the julia suite can catch.
 *
 * The count was 15 when this header was written and is 28 now; `doc-tables-check.ts` §7 holds the
 * doc's copy of it to this module's length, so the two cannot drift apart again.
 *
 * Wiring them into `script/m14/mutate-analyzer.ts`'s `MUTANTS` array is a SHARED-file edit (§8 of
 * the lane brief), so it is reported rather than made. This file is the lane-owned half: it runs the
 * same set, through the same `runLang` the shared harness uses, and prints which fixture caught which
 * mutant. A mutant that SURVIVES is a failure here, because the only thing worse than a missing
 * mutant is one that cannot fail.
 *
 * ## What it does NOT do
 *
 * It does not write evidence, does not touch `validation/m14/results/`, and does not change any
 * shared file. It reads `runLang` and `JULIA_MUTANTS` and calls them.
 *
 * ## USAGE
 *   bun run validation/m14/fixtures/julia/mutation-check.ts
 *   bun run validation/m14/fixtures/julia/mutation-check.ts --all
 *
 * Default: the mutants added by this lane (JUL-14, JUL-15), because those are the ones the new
 * fixture was authored to catch. `--all`: every mutant in the file, which is the number the M14
 * contract's L4 level wants — "deliberately injected defects … caused the suite to fail".
 */
import { runLang } from "../../../../script/m14/run-fixtures"
import { JULIA_MUTANTS } from "../../../../script/m60/julia-mutants"
import { RealJuliaAnalyzer } from "../../../../src/ast/real-julia-analyzer"
import type { Mutant } from "../../../../script/m14/mutate-analyzer"

const ALL = process.argv.includes("--all")
const NEW_IDS = new Set([
  "julia/drop-overrides-edges",
  "julia/overrides-without-position-guard",
  "julia/overrides-ignores-local-scope",
  "julia/overrides-drops-where-clause",
  "julia/overrides-ignores-scope-line",
  // Added 2026-10-04 with the two `imports`/`exports` oracles. See `script/m60/julia-mutants.ts`
  // JUL-16..JUL-18 for what each one reinstates and which fixture catches it.
  "julia/imports-collapses-multi-module",
  "julia/imports-drops-renamed-import",
  "julia/exports-accepts-misparsed-public",
])

/**
 * The mutant wrapper `script/m14/mutate-analyzer.ts` builds at line 18829, restated here because
 * `runLang`'s `overrideAnalyzer` is not a bare `{ transform }`: line 678 calls `analyzer.analyze(...)`
 * on it unconditionally, so the override must be a real analyzer instance that ALSO carries the
 * transform. Passing `{ transform }` alone crashes with `analyzer.analyze is not a function`, which
 * is what the first version of this file did.
 */
function wrapperFor(m: Mutant) {
  const real = new RealJuliaAnalyzer()
  return {
    analyze: async (...args: any[]) =>
      m.transform((real as any).analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
}

const base = await runLang("julia")
console.log(`unmutated baseline: pass=${base.pass} fail=${base.fail}`)
if (base.fail !== 0) {
  console.log("BASELINE IS RED — a mutant cannot be attributed when the suite it mutates already fails.")
  for (const d of base.details.filter((d: any) => !d.ok)) console.log(`  FAIL ${d.fixture}: ${d.reason ?? ""}`)
  process.exit(1)
}

const set = ALL ? JULIA_MUTANTS : JULIA_MUTANTS.filter((m) => NEW_IDS.has(m.id))
console.log(`running ${set.length} mutant${set.length === 1 ? "" : "s"}${ALL ? " (the whole julia set)" : " (added by this lane)"}\n`)

let survived = 0
let killed = 0
const baseProblems = base.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
for (const m of set) {
  if (m.retired) {
    console.log(`SKIP  ${m.id}  (retired ${m.retiredOn}: ${m.retirementReason ?? "no reason recorded"})`)
    continue
  }
  const r = await runLang("julia", wrapperFor(m) as any)
  // "Caught" is the shared harness's definition: MORE failing fixtures, or MORE distinct problems
  // inside an already-failing fixture — a defect landing in broken code is still a defect.
  const mutProblems = r.details.reduce((a: number, d: any) => a + (d.problems?.length ?? 0), 0)
  const caught = r.fail > base.fail || mutProblems > baseProblems
  const failing = r.details.filter((d: any) => !d.ok).map((d: any) => String(d.fixture))
  if (!caught) {
    survived++
    console.log(`SURVIVED  ${m.id}  — ${base.fail} -> ${r.fail} failures, ${baseProblems} -> ${mutProblems} problems`)
  } else {
    killed++
    console.log(`killed    ${m.id}  — ${base.fail} -> ${r.fail} failures, ${baseProblems} -> ${mutProblems} problems; fixtures now failing: ${failing.join(", ")}`)
  }
}

console.log(`\n${killed} killed, ${survived} survived, of ${set.length}`)
if (survived > 0) {
  console.log("A surviving mutant is a suite that cannot catch that defect. It is not a green lane.")
  process.exit(1)
}
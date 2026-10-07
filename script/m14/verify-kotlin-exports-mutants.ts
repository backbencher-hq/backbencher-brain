/**
 * Run the kotlin `exports` mutants and require each to be CAUGHT by a fixture.
 *
 * DERIV_EXPORTS_KOT3. The definitions live in `script/m14/kotlin-exports-mutants.ts`
 * (lane-owned). They are NOT yet registered in `script/m14/mutate-analyzer.ts`,
 * which is the shared registry the master agent owns — so `npm run audit:mutations`
 * does not run them, and this file is what produces the evidence instead. It
 * names the wiring it needs rather than leaving the gap implicit.
 *
 *     bun script/m14/verify-kotlin-exports-mutants.ts
 *
 * WHAT IT PROVES, precisely: each transform CHANGES production `parseFile`
 * output over the lane's own fixtures, so each mutant is observable and the
 * fixture that pins the changed quantity will fail. It does not re-implement the
 * fixture matcher — `script/m14/run-fixtures.ts` is the authority, and this
 * deliberately stays a reduction rather than impersonating it.
 *
 * Exit code 1 if any mutant is unobservable, because a mutant that changes
 * nothing is a false assurance.
 */
import { runKotlinExportsMutants } from "./kotlin-exports-mutants"

const results = await runKotlinExportsMutants()

console.log(`kotlin exports mutants — DERIV_EXPORTS_KOT3`)
console.log(`mutants: ${results.length}   (registered in script/m14/mutate-analyzer.ts? NO — shared file, wiring reported to master)`)
console.log("")
let uncaught = 0
for (const r of results) {
  console.log(`${r.caught ? "CAUGHT " : "SURVIVED"}  ${r.id}`)
  console.log(`         ${r.detail}`)
  if (!r.caught) uncaught++
}
console.log("")
console.log(`${results.length - uncaught}/${results.length} mutants observable in production parseFile output`)
console.log("")
console.log(`WIRING NEEDED (master owns script/m14/mutate-analyzer.ts, so this lane does not edit it):`)
console.log(`  import { KOTLIN_EXPORTS_MUTANTS } from "./kotlin-exports-mutants"`)
console.log(`  ...KOTLIN_EXPORTS_MUTANTS,   // inside the MUTANTS array`)
console.log(`Without those two lines these mutants are NOT run by npm run audit:mutations, and this`)
console.log(`file is the only thing executing them — the same shape the registry comment records for`)
console.log(`fsharp, css, nim and protobuf.`)

process.exitCode = uncaught === 0 ? 0 : 1

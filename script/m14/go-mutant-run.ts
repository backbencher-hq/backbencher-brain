/**
 * GO MUTANT RUN — does the lane's own fixture suite actually FAIL when the
 * analyzer is broken on purpose?
 *
 * ## Why this exists when `script/m14/mutate-analyzer.ts` exists
 *
 * `mutate-analyzer.ts` is MASTER-owned and the go registry in
 * `script/m14/go-mutants.ts` has to be spread into its `MUTANTS` array with one
 * line, which is reported rather than made. Until that wiring exists, a
 * registered mutant that nobody runs is indistinguishable from a defect class
 * with no mutant — the exact hole F4 exists to close.
 *
 * So this runner drives the REAL fixture runner (`runLang` from
 * `script/m14/run-fixtures.ts`, the same function `npm run audit:fixtures`
 * calls) over the REAL committed fixtures, with each mutant's `transform`
 * applied to the analyzer's RESULT, and reports whether the suite went red.
 *
 * ## HOW THE TRANSFORM IS APPLIED, and why it is a WRAPPER and not a direct call
 *
 * `runLang(lang, overrideAnalyzer)` assigns `analyzer = overrideAnalyzer` and
 * then calls `analyzer.analyze(...)`; it applies an `overrideAnalyzer.transform`
 * itself only on the SFC branch (vue/svelte/html/toml/markdown), where
 * `parseFile` is the real entry. A go mutant passed as `{ transform }` would
 * therefore be handed to `analyzer.analyze` and throw — which reads as "the
 * mutant was caught" when in fact the harness broke. So the mutant is wrapped in
 * an object that HAS an `analyze` method delegating to the real analyzer and
 * applying the transform to its result. The mutant's effect therefore reaches
 * the same assertion code the unmutated run reaches, which is the only way the
 * question "does the suite go red" means anything.
 *
 * ## WHAT A SURVIVOR MEANS HERE, stated before the numbers
 *
 * A survivor is not automatically a broken fixture. A transform can be
 * equivalent on the fixtures that exist — an `overrides` mutant in a lane whose
 * fixtures never promote a method — and still be a real defect class. So each
 * survivor is reported as a FIXTURE GAP and named as one, not counted as
 * coverage. A mutant no fixture can reach is unchecked, and saying otherwise
 * would be the dishonest reading.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { runLang } from "./run-fixtures"
import { GO_MUTANTS } from "./go-mutants"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")

type Row = { id: string; defectClass: string; description: string; caughtBy: string[]; survived: boolean; firstProblem: string; baselineClean: boolean }
const rows: Row[] = []
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : ""

const baseline = await runLang("go")
const baseDetails = new Map<string, any>((baseline.details ?? []).map((d: any) => [String(d.fixture), d]))
const baseClean = baseline.fail === 0
console.log(`\nbaseline: ${baseline.pass} pass / ${baseline.fail} fail over the committed go fixtures`)
if (!baseClean) {
  for (const d of baseline.details ?? []) if (d.ok === false) console.log(`  BASELINE RED  ${d.fixture}  ${String((d.problems ?? [])[0] ?? d.reason ?? "").slice(0, 110)}`)
  console.log(`\nA RED BASELINE INVALIDATES EVERY MUTANT BELOW: a suite that already fails cannot demonstrate that a mutant fails. Fix the baseline first.`)
  process.exit(1)
}

/** The mutant as something `runLang` can call: an object with `analyze`, which
 *  delegates and then applies the transform. See the header for why. */
const mutantAnalyzer = (transform: (r: any, src?: string) => any): any => ({
  async analyze(rootNode: any, content: string, filePath: string, ctx?: any) {
    const mod: any = await import("../../src/ast/real-go-analyzer")
    const real = new mod.RealGoAnalyzer()
    const result = await real.analyze(rootNode, content, filePath, ctx)
    return transform(result, content)
  },
})

for (const m of GO_MUTANTS) {
  if (only && m.id !== only) continue
  let run: any
  try {
    run = await runLang("go", mutantAnalyzer(m.transform))
  } catch (e) {
    rows.push({ id: m.id, defectClass: m.defectClass, description: m.description, caughtBy: [], survived: false, firstProblem: `HARNESS THREW: ${String(e).slice(0, 90)}`, baselineClean: true })
    continue
  }
  const caughtBy: string[] = []
  let firstProblem = ""
  for (const d of run.details ?? []) {
    if (d.ok === false) {
      const base = baseDetails.get(String(d.fixture))
      // Only count it as CAUGHT if the same fixture was green before. A fixture
      // that was already red tells you nothing about this mutant.
      if (base && base.ok !== false) {
        caughtBy.push(String(d.fixture).replace(/^go\//, ""))
        if (!firstProblem) firstProblem = String((d.problems ?? [])[0] ?? "").slice(0, 110)
      }
    }
  }
  rows.push({ id: m.id, defectClass: m.defectClass, description: m.description, caughtBy, survived: caughtBy.length === 0, firstProblem, baselineClean: true })
}

console.log(`\ngo lane mutants — ${rows.length} registered, each run through runLang("go") over validation/m14/fixtures/go\n`)
console.log("-".repeat(118))
for (const r of rows) {
  console.log(`${r.survived ? "SURVIVOR" : "caught  "}  ${r.id.padEnd(46)} ${r.defectClass}`)
  if (r.caughtBy.length) console.log(`          caught by ${r.caughtBy.length}: ${r.caughtBy.slice(0, 6).join(", ")}${r.caughtBy.length > 6 ? ", ..." : ""}`)
  if (r.firstProblem) console.log(`          ${r.firstProblem}`)
}
console.log("-".repeat(118))
const caught = rows.filter((r) => !r.survived).length
console.log(`${caught}/${rows.length} mutants caught`)
if (caught < rows.length) {
  console.log(`\nSURVIVORS — read as FIXTURE GAPS, not as passing mutants:`)
  for (const r of rows.filter((x) => x.survived)) {
    console.log(`  ${r.id} (${r.defectClass})`)
    console.log(`      ${r.description.slice(0, 150)}`)
    console.log(`      No committed go fixture reaches this construct, so the defect class is real and UNCHECKED.`)
  }
}
process.exit(0)
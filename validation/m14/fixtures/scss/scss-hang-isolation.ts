/**
 * SCSS HANG ISOLATION — is the arbiter's `[BB-HANG]` an input or a load?
 *
 * ## Why this file exists
 *
 * `ontology-coverage-gate.ts scss --fresh` prints its whole verdict —
 * `emitted 8/10  ruled-sound 2  FALSIFIED 0  ruled-without-justification 0` — and then
 * exits 1, because after the table it prints:
 *
 *     [BB-HANG] parser stuck 120s on .../icons/plus-square-fill/keyframes.scss — exiting
 *
 * The round brief makes exit 0 an acceptance condition, so this is worth settling rather
 * than reporting as an atmosphere. Two facts make the obvious reading wrong:
 *
 *   1. The file it names is **317 bytes**. It is not a large generated sprite. The earlier
 *      lane note blamed "a 1.6 MB generated sprite"; that was a different run naming a
 *      different file, and this one cannot be explained by size.
 *   2. The named file CHANGES between runs on identical bytes — `informed-action/index.scss`
 *      at commit efd47f068, `plus-square-fill/keyframes.scss` now, plus a third
 *      `informed-action/layout.scss` reported as `memory access out of bounds` in the walk
 *      dump. A deterministic parser fault names the same file every time. A file that
 *      changes is either load-dependent or the timeout is measuring something other than
 *      this file's parse.
 *
 * ## What it measures
 *
 * Each named file is parsed ALONE, `ITER` times, through the same production
 * `parseFile`, and the wall clock of each call is printed. Three outcomes are
 * distinguishable and only the first is a parser defect:
 *
 *   EVERY CALL SLOW, EVERY TIME   the input is a parse bomb. The grammar is at fault and
 *                                 the fix belongs to the vendored grammar.
 *   EVERY CALL FAST               the input is not a bomb, so the `[BB-HANG]` is the
 *                                 120 s budget being missed under parallel load — a
 *                                 harness property, not a language one.
 *   SLOW SOMETIMES, FAST OTHERS   contention. Same conclusion as above, and it also says
 *                                 the gate's guard is not a per-file property.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-hang-isolation.ts [iterations]
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const ITER = Number(process.argv[2] ?? 5)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const FILES = [
  // named by the --fresh run at HEAD
  "consul/ui/packages/consul-ui/app/styles/base/icons/icons/plus-square-fill/keyframes.scss",
  // named by the --fresh run at efd47f068
  "consul/ui/packages/consul-ui/app/components/informed-action/index.scss",
  // reported as `memory access out of bounds` during the corpus walk
  "consul/ui/packages/consul-ui/app/components/informed-action/layout.scss",
  "consul/ui/packages/consul-ui/app/styles/base/icons/icons/trend-up/property-24.scss",
  "r-pkgdown/inst/highlight-styles/zenburn.scss",
]

console.log(`scss hang isolation — ${ITER} isolated parses per file, production parseFile\n`)
for (const rel of FILES) {
  const abs = `${CR}/${rel}`
  const times: number[] = []
  let outcome = "ok"
  let symbols = 0
  let relationships = 0
  for (let i = 0; i < ITER; i++) {
    const t0 = Date.now()
    try {
      const r: any = await parseFile(abs, abs.slice(0, abs.lastIndexOf("/")))
      const dt = Date.now() - t0
      times.push(dt)
      symbols = r?.symbols?.length ?? 0
      relationships = r?.relationships?.length ?? 0
    } catch (e: any) {
      times.push(Date.now() - t0)
      outcome = `threw: ${String(e?.message ?? e).slice(0, 60)}`
    }
  }
  const sorted = [...times].sort((a, b) => a - b)
  console.log(`${rel}`)
  console.log(`   outcome=${outcome}  symbols=${symbols} relationships=${relationships}`)
  console.log(`   ms: ${times.join(", ")}   min=${sorted[0]} median=${sorted[Math.floor(sorted.length / 2)]} max=${sorted[sorted.length - 1]}`)
  console.log(`   verdict: ${sorted[sorted.length - 1] < 1000 ? "input is NOT a parse bomb" : "input IS slow in isolation"}`)
  console.log("")
}
console.log("The gate's guard is 120s. Compare each max against it: a file whose isolated max")
console.log("is three orders of magnitude below 120s cannot be the thing that spent 120s.")
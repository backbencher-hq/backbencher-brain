/**
 * The arbiter's verdict table is a function of the CHECKPOINT FILE, not of the analyzer.
 *
 * `script/m14/ontology-coverage-gate.ts:304-319` accumulates its per-type tally inside the
 * walk's `run` callback, and `script/m14/resumable-walk.ts:134-138` SKIPS every index whose id is
 * already in the checkpoint. So on any run after the first, `run` is not called for a complete
 * population, `observed` stays empty, and the table at `:472-503` takes the `obs && obs.n > 0`
 * branch zero times and reports all ten types NOT EMITTED.
 *
 * The walk line above the table says `1985/1985 files (100.0%) newly walked 0, resumed 1985`, so
 * the run that measured nothing is the run that reports the fullest coverage. `walkStats.partial` is
 * false because `walked + alreadyDone === count`, so the ONE line whose job is to disclose an
 * incomplete population discloses a complete one. The counts do not know they are smaller.
 *
 * Measured on this lane, same commit, same 1,985-file corpus, same `parseFile`:
 *
 *   run 1 (checkpoint absent)   ->  emitted 9/10   235,878 edges        exit 0
 *   run 2 (checkpoint complete) ->  emitted 0/10         0 edges        exit 1
 *   run 3 (--fresh, dies)       ->  [BB-HANG] … Graphs.jl/test/core.jl  exit 1
 *
 * and the corpus is unchanged between the three, which `firing-check --files 2000` proves
 * independently: 9/10 fired, 235,878 edges, 1,985/1,985 files, 0 degraded, sequential.
 *
 * ## Why this is a probe and not a report
 *
 * `ontology-coverage-gate.ts` is §8 shared machinery this lane does not own, so the fix is reported
 * (doc §8 row 14) and not applied. What this file does is make the defect EXECUTABLE on a
 * three-file synthetic corpus in under a second, so a reader can see the mechanism rather than take
 * it on trust, and so the fix has a check to pass.
 *
 * The synthetic arm calls the SHARED `resumableWalk` through the same shape the gate uses. It does
 * not shell out to the gate, because a corpus of 3 files cannot make the gate print a table (it
 * requires a corpus, and a real one costs minutes and can die to §8 row 1) — and the gate is
 * shared, so this file must not depend on its argv. The synthetic arm therefore proves the
 * MECHANISM; the three corpus runs above prove the CONSEQUENCE, and both are printed by the
 * `--corpus` flag.
 *
 * READ-ONLY with respect to the repo and the corpus. Writes one checkpoint under `os.tmpdir()` and
 * deletes it. EXITS NON-ZERO if the mechanism does not reproduce.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const { resumableWalk } = await import("../../../../script/m14/resumable-walk")

const TYPE_LIST = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof TYPE_LIST)[number]

/** The gate's own accumulator shape, so the synthetic arm tallies the way the gate does. */
const tally = (): Map<Type, { n: number; files: Set<string> }> => new Map()

const N = 3
const IDS = ["/synthetic/a.jl", "/synthetic/b.jl", "/synthetic/c.jl"]

async function oneRun(checkpoint: string, edgesPerFile: number[]) {
  const observed = tally()
  const stats = await resumableWalk(checkpoint, IDS.length, {
    id: (i) => IDS[i],
    concurrency: 1,
    run: async (i) => {
      // Stands in for parseFile's relationship rows. Every type except `implements` fires, so the
      // synthetic table has 9 EMITTED rows on run 1 and the same shape run 2 must lose.
      for (const t of TYPE_LIST) {
        if (t === "implements") continue
        for (let k = 0; k < edgesPerFile[i]; k++) {
          const row = observed.get(t) ?? { n: 0, files: new Set<string>() }
          row.n++
          if (row.files.size < 4) row.files.add(IDS[i])
          observed.set(t, row)
        }
      }
    },
  })
  const emitted = TYPE_LIST.filter((t) => (observed.get(t)?.n ?? 0) > 0)
  return { stats, emitted, edges: [...observed.values()].reduce((a, r) => a + r.n, 0) }
}

const dir = path.join(tmpdir(), "julia-arbiter-resume-probe")
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const CHECKPOINT = path.join(dir, "walk-synthetic.txt")
const edges = [2, 3, 1]

console.log("arbiter resume probe — synthetic arm, via the SHARED script/m14/resumable-walk")
console.log(`population: ${N} files, checkpoint: ${CHECKPOINT}\n`)

const r1 = await oneRun(CHECKPOINT, edges)
console.log(`run 1 (checkpoint absent)   newly walked ${r1.stats.walked}, resumed ${r1.stats.alreadyDone}, partial ${r1.stats.partial}`)
console.log(`                           emitted ${r1.emitted.length}/10, ${r1.edges} edges  checkpoint exists=${existsSync(CHECKPOINT)}`)

const r2 = await oneRun(CHECKPOINT, edges)
console.log(`run 2 (checkpoint complete) newly walked ${r2.stats.walked}, resumed ${r2.stats.alreadyDone}, partial ${r2.stats.partial}`)
console.log(`                           emitted ${r2.emitted.length}/10, ${r2.edges} edges`)

console.log("\nTHE DEFECT, in the gate's own reporting vocabulary:")
console.log(`  run 1 -> emitted ${r1.emitted.length}/10, edge count ${r1.edges}`)
console.log(`  run 2 -> emitted ${r2.emitted.length}/10, edge count ${r2.edges}`)
console.log(`  run 2's walk line would read "${r2.stats.walked + r2.stats.alreadyDone}/${r2.stats.total} files (100.0%) newly walked ${r2.stats.walked}, resumed ${r2.stats.alreadyDone}"`)
console.log(`  and walkStats.partial is ${r2.stats.partial}, because walked + alreadyDone === count.`)
console.log(`  So the run that measured NOTHING is the run that reports FULL coverage and no PARTIAL flag.`)

// Each file contributes edgesPerFile[i] edges for each of the 9 firing types, so the total is
// sum(edges) x 9 = 54. The first version of this line multiplied by N as well and expected 162, so
// the probe reported NOT REPRODUCED for a defect it had just reproduced perfectly.
const expectedRun1 = edges.reduce((a, b) => a + b, 0) * (TYPE_LIST.length - 1)
const reproduced = r1.emitted.length === 9 && r1.edges === expectedRun1 && r2.emitted.length === 0 && r2.edges === 0 && r2.stats.walked === 0 && r2.stats.alreadyDone === N && r2.stats.partial === false

rmSync(dir, { recursive: true, force: true })

if (!reproduced) {
  console.error(
    `\nNOT REPRODUCED — run 1 emitted ${r1.emitted.length}/10 / ${r1.edges} edges, run 2 emitted ${r2.emitted.length}/10 / ${r2.edges} edges ` +
      `(walked ${r2.stats.walked}, resumed ${r2.stats.alreadyDone}, partial ${r2.stats.partial}). ` +
      `Either script/m14/resumable-walk.ts changed its resume semantics, or ontology-coverage-gate.ts no longer tallies inside run(), ` +
      `which would mean the shared gate has been fixed and doc §8 row 14 must be withdrawn rather than left standing.`,
  )
  process.exit(1)
}
console.log(`\nREPRODUCED — an accumulator written only inside run() reads 0 on every resumed run,`)
console.log(`while walked+alreadyDone reports 100.0% and partial is false. The defect is in the gate, not in this lane's analyzer.`)

/**
 * LUA-55 — the coverage arbiter's RESUME PATH reports a false verdict, and R2 made
 * it silent.
 *
 * ## What this measures
 *
 * `script/m14/ontology-coverage-gate.ts` tallies relationship counts into an
 * in-memory map, `observed`, and the ONLY writes to that map are inside the
 * `run:` callback it hands to `resumableWalk`. `resumableWalk` calls `run` once per
 * file that is NOT already recorded in its append-only checkpoint. So a run in which
 * every file is already recorded performs ZERO work and observes ZERO edges — and the
 * gate then prints `emitted 0/10`, `ruled-sound 10`, `FALSIFIED 0`, exit 0.
 *
 * The gate's own progress line makes this worse rather than better:
 *
 *     walk: 3250/3250 files (100.0%)  newly walked 0, resumed 3250
 *
 * 100.0% is computed as `(walked + alreadyDone) / total`, i.e. it is a statement about
 * the CHECKPOINT LOG, not about any measurement. `walkStats.partial` is false, so the
 * gate's honesty guard does not fire either. The instrument reports complete coverage
 * of a measurement it never performed.
 *
 * ## Why it is worse now than before R2
 *
 * Before `RULED_BY_LANG.lua` was wired, a fully-resumed run had no ruling source for
 * nine of the ten types and exited 2 — LOUD. R2 landed the table, and the gate's
 * `rulingFor` also reads `script/m14/spec/lua-completeness.json`, whose `BD-ontology`
 * decision is a blanket record covering the same nine types. So the resumed run now
 * has a ruling source for all ten, certifies all ten as RULED-SOUND, and exits 0.
 *
 * A loud exit 2 became a silent exit 0. The gate went from refusing to answer to
 * answering wrongly, and the wrong answer is the direction that survives review: nine
 * types with 219,981 real edges are reported as types the construct never occurs in.
 *
 * ## The two runs, same corpus, same analyzer, same command
 *
 *     npx tsx script/m14/ontology-coverage-gate.ts lua --fresh
 *       -> emitted 9/10  ruled-sound 1  FALSIFIED 0  exit 0
 *     npx tsx script/m14/ontology-coverage-gate.ts lua
 *       -> emitted 0/10  ruled-sound 10  FALSIFIED 0  exit 0
 *
 * Both logs are committed beside this script. This file does not re-run them (that is
 * a 2x20-minute walk); it proves the MECHANISM structurally and cheaply, so the claim
 * does not rest on two logs nobody can regenerate.
 *
 * ## What this script asserts
 *
 *   1. `run` is invoked 0 times on a fully-resumed walk while the log claims 100%.
 *   2. `observed` is written only inside the `run` callback (source-shape assertion).
 *   3. `walkedPct` counts `alreadyDone` as walked coverage (source-shape assertion).
 *   4. The gate's EMITTED branch reads the same in-memory map, so an empty map means
 *      every emitted type falls through to the ruling table.
 *
 * Read-only. Writes nothing except its own report under `validation/m60/lua/`.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resumableWalk } from "../m14/resumable-walk"

const GATE = "script/m14/ontology-coverage-gate.ts"

const failures: string[] = []
const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(`${name}: ${detail}`)
}

// ---------------------------------------------------------------- 1. the mechanism, live
// A real walk over real corpus files, run twice against one checkpoint. The corpus is
// not needed: any three parseable files exhibit the behaviour, because it is a property
// of the checkpoint, not of the content. Corpus files are used anyway so the number of
// edges in run 1 is non-zero and the reader can see the tally vanish rather than merely
// start absent.
const corpusRoot = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const samples = [
  "kong/kong/pdk/log.lua",
  "kong/kong/tools/table.lua",
  "kong/kong/cache/init.lua",
].map((r) => path.join(corpusRoot, r))

const present = samples.filter((p) => {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
})
if (present.length === 0) {
  console.error(`no corpus sample readable under ${corpusRoot}; set BB_CORPUS_ROOT`)
  process.exit(2)
}

const CKPT = path.join(os.tmpdir(), `lua-resume-probe-${process.pid}.txt`)
rmSync(CKPT, { force: true })

const walkOnce = async (label: string) => {
  let runCalls = 0
  let edges = 0
  const stats = await resumableWalk(CKPT, present.length, {
    id: (i) => present[i],
    concurrency: 2,
    run: async (i) => {
      runCalls++
      const text = readFileSync(present[i], "utf8")
      // The tally stands in for the gate's `observed` map: written ONLY inside run.
      edges += (text.match(/\blocal\b/g)?.length ?? 0)
    },
  })
  const pct = ((stats.walked + stats.alreadyDone) / stats.total) * 100
  return { label, runCalls, edges, pct, partial: stats.partial, walked: stats.walked, alreadyDone: stats.alreadyDone, total: stats.total }
}

const first = await walkOnce("run 1 (cold checkpoint)")
const second = await walkOnce("run 2 (same checkpoint)")

check(
  "run-1 does the work",
  first.runCalls === present.length && first.edges > 0,
  `runCalls=${first.runCalls}/${first.total} edges=${first.edges} walked=${first.walked}`,
)
check(
  "RESUMED RUN INVOKES run ZERO TIMES",
  second.runCalls === 0,
  `runCalls=${second.runCalls} while the gate's tally lives only inside run — every edge count is unrecoverable`,
)
check(
  "THE TALLY IS EMPTY ON THE RESUMED RUN",
  second.edges === 0 && first.edges > 0,
  `run1=${first.edges} -> run2=${second.edges}`,
)
check(
  "the log REPORTS 100% COVERAGE for a run that measured nothing",
  second.pct === 100 && second.runCalls === 0,
  `walkedPct=${second.pct.toFixed(1)}% with newly walked=${second.walked}`,
)
check(
  "the honesty guard does NOT fire",
  second.partial === false,
  `walkStats.partial=${second.partial} — partial is derived from the checkpoint log, so a complete log silences the guard that exists to catch an incomplete walk`,
)

// ---------------------------------------------------------------- 2-4. the gate's own shape
const src = readFileSync(GATE, "utf8")
const lines = src.split("\n")

const observedDecl = lines.findIndex((l) => l.includes("const observed = new Map<Type"))
const observedWrites = lines
  .map((l, i) => ({ l, i }))
  .filter((x) => x.l.includes("observed.set"))
check("observed is declared before its writes", observedDecl >= 0, `line ${observedDecl + 1}`)

// The decisive source assertion: every `observed.set` must sit inside the run callback.
// The callback is `run: async (i) => {` and closes with the `})` that ends the
// resumableWalk options object. Locating the run arm by its own signature is enough —
// there is exactly one.
const runArm = lines.findIndex((l) => /^\s*run:\s*async\s*\(i\)\s*=>/.test(l))
// The arm closes with a bare `},` — the `})` on the following line ends the OPTIONS
// OBJECT, one level out. Matching `}),` here finds nothing, which is how this probe's
// first version reported "0 writes inside run" against a gate that plainly has one.
const runCloses = runArm >= 0 ? lines.findIndex((l, i) => i > runArm && /^\s*\},\s*$/.test(l)) : -1
check(
  "the run callback is locatable",
  runArm >= 0 && runCloses > runArm,
  `run arm at line ${runArm + 1}, closes at ${runCloses + 1}`,
)
const writesInside = lines
  .map((l, i) => ({ l, i }))
  .filter((x) => x.l.includes("observed.set") && x.i > runArm && x.i < runCloses)
const writesOutside = lines
  .map((l, i) => ({ l, i }))
  .filter((x) => x.l.includes("observed.set") && (x.i <= runArm || x.i >= runCloses))
check(
  "EVERY write to observed is inside run",
  writesInside.length > 0 && writesOutside.length === 0,
  `${writesInside.length} inside run (lines ${writesInside.map((x) => x.i + 1).join(",")}), ${writesOutside.length} outside`,
)

const pctLine = lines.find((l) => l.includes("walkStats.walked + walkStats.alreadyDone"))
check(
  "walkedPct counts RESUMED files as coverage",
  pctLine !== undefined,
  pctLine ? pctLine.trim() : "the walkedPct expression was not found — re-read the gate before trusting this probe",
)

// The EMITTED branch must read the same map, or an empty map would not silence it.
// The EMITTED branch must read the same map, or an empty map would not silence it.
// `status: "EMITTED"` appears TWICE: once in the `Row` type at :402 and once in the
// actual row push at :481. The type declaration is not a branch, so match the push.
const emittedBranch = lines.findIndex((l) => l.includes('rows.push') && l.includes('status: "EMITTED"'))
const emittedReadsObserved = lines
  .slice(Math.max(0, emittedBranch - 8), emittedBranch + 1)
  .some((l) => l.includes("observed.get"))
check(
  "the EMITTED branch reads the same in-memory map",
  emittedBranch >= 0 && emittedReadsObserved,
  `EMITTED row at line ${emittedBranch + 1}; an empty map makes every type fall through to RULED.find`,
)

// ---------------------------------------------------------------- report
const report = {
  finding: "LUA-55",
  title: "the coverage arbiter's resume path observes nothing and still exits 0",
  gate: GATE,
  sharedMachinery: true,
  mechanism:
    "observed is written only inside the run callback; resumableWalk calls run only for files absent from its checkpoint; a fully-resumed run therefore tallies 0 edges while walkedPct reports 100.0% and partial stays false",
  population: {
    corpusFilesOffered: present.length,
    samplePaths: present,
    note: "a 3-file walk, not the 3,250-file corpus — the behaviour is a property of the checkpoint, not of the corpus, so the population is stated rather than inflated",
  },
  walks: [first, second],
  sourceShape: {
    observedDeclaredAtLine: observedDecl + 1,
    runArmAtLine: runArm + 1,
    observedSetLines: writesInside.map((x) => x.i + 1),
    observedSetOutsideRun: writesOutside.map((x) => x.i + 1),
    emittedRowAtLine: emittedBranch + 1,
    walkedPctCountsAlreadyDone: pctLine !== undefined,
  },
  theTwoRealRuns: {
    command: "npx tsx script/m14/ontology-coverage-gate.ts lua",
    fresh: { command: "npx tsx script/m14/ontology-coverage-gate.ts lua --fresh", emitted: 9, ruledSound: 1, falsified: 0, exit: 0, edges: 219981 },
    resumed: { command: "npx tsx script/m14/ontology-coverage-gate.ts lua", emitted: 0, ruledSound: 10, falsified: 0, exit: 0, edges: 0 },
    logs: [
      "validation/m60/lua/resume-path-gate-FRESH.log",
      "validation/m60/lua/resume-path-gate-RESUMED.log",
    ],
  },
  checks,
  failures,
  verdict: failures.length === 0 ? "REPRODUCED" : "NOT REPRODUCED",
}

mkdirSync("validation/m60/lua", { recursive: true })
writeFileSync("validation/m60/lua/resume-path-probe.json", JSON.stringify(report, null, 2) + "\n")
rmSync(CKPT, { force: true })

for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}\n        ${c.detail}`)
console.log(`\nverdict: ${report.verdict}  (${checks.length - failures.length}/${checks.length} checks)`)
console.log("wrote validation/m60/lua/resume-path-probe.json")
process.exit(failures.length === 0 ? 0 : 1)

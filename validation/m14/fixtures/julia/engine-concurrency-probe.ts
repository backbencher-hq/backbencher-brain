/**
 * WHY THIS FILE EXISTS
 * --------------------
 * `docs/analyzers/julia.md` carried, as its headline, a verbatim block of
 * `script/m14/ontology-coverage-gate.ts julia` output ending `exit 0` and asserting that the run
 * reported **0 `[BB-PARSE-ERR]` and 0 `[BB-HANG]` lines**. On current shared machinery that block
 * does not reproduce: the gate prints a `[BB-PARSE-ERR] … memory access out of bounds`, then a
 * `[BB-HANG]` naming the SAME file 110 seconds later, and then exits 1 **without printing the
 * verdict table at all**.
 *
 * Two facts make that block untrustworthy rather than merely stale, and this probe measures both.
 *
 * 1. THE TWO LOG LINES ARE ONE EVENT, and the second one is a lie about its own file.
 *    `src/ast/engine.ts:1441-1447` arms a 120 s self-destruct timer and calls `clearTimeout`
 *    AFTER `parser.parse(content)`:
 *
 *        const parseBomb = setTimeout(() => { …process.exit(1) }, 120000)
 *        const tree = parser.parse(content)
 *        clearTimeout(parseBomb)
 *
 *    A parse that RETURNS clears its own bomb. A parse that THROWS never reaches line 1447, so its
 *    bomb stays armed. `parseFile` catches the throw, logs `[BB-PARSE-ERR]`
 *    (`src/ast/pool-worker.ts:1231`) and returns `extractFallback`, and the run continues — until
 *    the orphaned timer fires and kills a process that is by then parsing a different file. So
 *    `[BB-HANG] parser stuck 120s on X` does not mean X was slow. It means some file threw at some
 *    point in the previous 120 seconds, and X is whichever file armed the oldest surviving bomb.
 *
 *    The FIRST version of this probe proved that the hard way: it counted armings against
 *    clearings and was itself killed by the bomb before it could print, because the bomb calls
 *    `process.exit(1)` and the probe had no way to survive its own finding. So this version keeps
 *    the count AND neutralises the exit: a 120000 ms timer still fires on schedule, but instead of
 *    ending the process it records when it fired, how long after it was armed, and the file its
 *    callback named (recovered by intercepting the `[BB-HANG]` line the callback writes). The fire is
 *    then OBSERVED rather than inferred, and the probe still reports.
 *
 * 2. `parseFile` is not concurrency-safe on this corpus, and the two instruments differ ONLY in
 *    width. This probe walks the same admitted file set with the same `parseFile` at three widths,
 *    INTERLEAVED over several rounds, and counts what each width throws. Interleaving is the point:
 *    a lane already measured a 27% swing in its own throughput that turned out to be machine load
 *    rather than code, so an arm that owns the quietest minute of the run proves nothing.
 *    `script/m14/ontology-coverage-gate.ts:240` uses 8 workers; `script/m14/firing-check.ts:290`
 *    uses a sequential `for` loop; `census.ts:82` uses 4.
 *
 * The file is instrument-only and writes nothing. It changes no verdict: `firing-check` over all
 * 1,985 files reports `degraded: 0` and 234,796 edges, and the census agrees to the edge. What it
 * establishes is WHY the arbiter cannot be quoted at `exit 0`, which is a statement about a shared
 * gate's ability to finish, not about this lane's analyzer.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/julia/engine-concurrency-probe.ts
 *   npx tsx validation/m14/fixtures/julia/engine-concurrency-probe.ts --files 400
 *   npx tsx validation/m14/fixtures/julia/engine-concurrency-probe.ts --rounds 3
 */

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

// ---------------------------------------------------------------- timer instrumentation
// Installed BEFORE `parseFile` is imported, because `src/ast/engine.ts` calls the GLOBAL
// setTimeout at parse time and captures nothing — a post-import patch would still intercept it,
// but arming the patch first removes the question of module-init order entirely.
type Armed = { id: unknown; seq: number; armedAt: number }
type Fired = { seq: number; armedAt: number; firedAt: number; named: string; exitCode: number | null }
const armed: Armed[] = []
const fired: Fired[] = []
// Node's setTimeout returns a Timeout OBJECT, not a number. The first version of this probe
// guarded `clearTimeout` with `typeof id === "number"`, so it never matched a single id and
// reported `CLEARED: 0 / NEVER CLEARED: 10798` — an artifact of the instrument that read exactly
// like the defect it was built to measure. Keyed by identity instead.
const armedById = new Map<unknown, Armed>()
const cleared = new Set<unknown>()
const exitAttempts: number[] = []
let seq = 0

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realWrite = process.stderr.write.bind(process.stderr)

// The engine's self-destruct is the only 120000 ms timer on this path. Matching on the DURATION
// rather than on the callback's source text keeps this a structural instrument: it does not read
// the engine's source, so it cannot be fooled by a reformat, and it cannot match a comment.
const BOMB_MS = 120000

// The callback writes `[BB-HANG] parser stuck 120s on <path> — exiting` and then exits. Intercepting
// the write is how the file the callback NAMES is recovered, without reading a closure.
;(process.stderr as any).write = function (chunk: any, ...rest: any[]): boolean {
  const text = typeof chunk === "string" ? chunk : String(chunk)
  if (text.includes("[BB-HANG]")) {
    const m = text.split("on ")[1]?.split(" —")[0] ?? "<unparsed>"
    lastHangName = m
  }
  return realWrite(chunk, ...rest) as unknown as boolean
}
let lastHangName = "<none>"

;(globalThis as any).setTimeout = function (fn: any, ms?: number, ...rest: any[]) {
  if (ms === BOMB_MS) {
    const mySeq = seq++
    const armedAt = Date.now()
    const id = realSetTimeout(
      () => {
        // The bomb fires. Observe it: stub `process.exit` for the duration of the callback only, so
        // the callback runs to completion (writing its line, which is what names the file) and the
        // probe survives to report.
        const realExit = process.exit
        const record = { code: null as number | null }
        ;(process as any).exit = function (code?: number): never {
          record.code = typeof code === "number" ? code : 0
          exitAttempts.push(record.code)
          return undefined as never
        }
        lastHangName = "<none>"
        try {
          fn()
        } catch {
          /* the real exit is stubbed; anything it throws is the stub, not a finding */
        } finally {
          ;(process as any).exit = realExit
        }
        fired.push({ seq: mySeq, armedAt, firedAt: Date.now(), named: lastHangName, exitCode: record.code })
      },
      ms,
      ...rest,
    ) as unknown as number
    armed.push({ id, seq: mySeq, armedAt })
    armedById.set(id, armed[armed.length - 1])
    return id
  }
  return realSetTimeout(fn, ms, ...rest)
}
;(globalThis as any).clearTimeout = function (id?: any) {
  if (id !== undefined && id !== null) cleared.add(id)
  return realClearTimeout(id)
}

const { parseFile } = await import("../../../../src/ast/pool-worker")

// ---------------------------------------------------------------- args
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "julia"
const argOf = (flag: string, dflt: number) => {
  const i = process.argv.indexOf(flag)
  if (i < 0) return dflt
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) && v > 0 ? v : dflt
}
const FILE_LIMIT = argOf("--files", 400)
const ROUNDS = argOf("--rounds", 3)
const ARMS = [1, 4, 8]

// ---------------------------------------------------------------- corpus (same admission rule as census.ts)
const files: { repo: string; rel: string; abs: string; dir: string }[] = []
let skippedLargeJulia = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) {
        if (path.extname(rel).toLowerCase() === ".jl") skippedLargeJulia++
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, abs, dir })
  }
}

// Stride sample, the same shape `firing-check --files N` uses, so the file set is not the variable
// between this probe and the instrument it is explaining.
const stride = Math.max(1, Math.floor(files.length / FILE_LIMIT))
const sample = files.filter((_, i) => i % stride === 0).slice(0, FILE_LIMIT)
const label = (f: (typeof sample)[number]) => `${f.repo}/${f.rel}`

console.log(`engine concurrency probe — julia`)
console.log(`corpus root: ${CR}`)
console.log(
  `admitted ${files.length} .jl files; sample ${sample.length} (stride ${stride}); rounds ${ROUNDS}; arms ${ARMS.join(", ")}`,
)
console.log(`over 512 KB, skipped: ${skippedLargeJulia} julia files`)
console.log(
  `load1 at start: ${(await import("node:os")).loadavg()[0].toFixed(2)} on ${(await import("node:os")).cpus().length} cores`,
)

// ---------------------------------------------------------------- one arm
type ArmResult = {
  width: number
  round: number
  parsed: number
  threwOutOfParseFile: number
  degradedFallback: number
  errors: Map<string, number>
  badFiles: string[]
}

async function runArm(width: number, round: number): Promise<ArmResult> {
  const res: ArmResult = {
    width,
    round,
    parsed: 0,
    threwOutOfParseFile: 0,
    degradedFallback: 0,
    errors: new Map(),
    badFiles: [],
  }
  let i = 0
  const worker = async () => {
    while (true) {
      const k = i++
      if (k >= sample.length) return
      const f = sample[k]
      let r: any
      const t0 = Date.now()
      try {
        r = await parseFile(f.abs, f.dir)
      } catch (e: any) {
        res.threwOutOfParseFile++
        const m = String(e?.message ?? e).slice(0, 120)
        res.errors.set(m, (res.errors.get(m) ?? 0) + 1)
        res.badFiles.push(`${label(f)} :: THREW ${m}`)
        continue
      }
      res.parsed++
      if (r?.fallback === true) {
        res.degradedFallback++
        res.badFiles.push(`${label(f)} :: fallback`)
      }
      void t0
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()))
  return res
}

// ---------------------------------------------------------------- run, interleaved
const results: ArmResult[] = []
for (let round = 1; round <= ROUNDS; round++) {
  // Interleaved, not arm-then-arm: the earlier lane measurement in this file's own history is that
  // a figure taken while other agents were on the host moved 27% with no code change. Ordering the
  // arms round-robin means each width sees a comparable share of the machine.
  for (const width of ARMS) {
    const before = armed.length
    const r = await runArm(width, round)
    const newBombs = armed.length - before
    r.errors.set(`__bombs_armed__${newBombs}`, 0)
    results.push(r)
    const os = await import("node:os")
    console.log(
      `round ${round} width ${width}: parsed ${r.parsed}/${sample.length}  degraded ${r.degradedFallback}  threw ${r.threwOutOfParseFile}  bombs armed ${newBombs}  load1 ${os.loadavg()[0].toFixed(2)}`,
    )
  }
}

// ---------------------------------------------------------------- report
console.log(`\nPER-ARM TOTALS over ${ROUNDS} round(s)`)
console.log(`width  arms-run  parsed   degraded  threw   distinct-bad-files`)
for (const width of ARMS) {
  const rs = results.filter((r) => r.width === width)
  const parsed = rs.reduce((a, r) => a + r.parsed, 0)
  const degraded = rs.reduce((a, r) => a + r.degradedFallback, 0)
  const threw = rs.reduce((a, r) => a + r.threwOutOfParseFile, 0)
  const bad = new Set(rs.flatMap((r) => r.badFiles.map((b) => b.split(" ::")[0])))
  console.log(
    `${String(width).padEnd(6)} ${String(rs.length).padEnd(9)} ${String(parsed).padEnd(8)} ${String(degraded).padEnd(9)} ${String(threw).padEnd(7)} ${bad.size}`,
  )
}

const allBad = new Map<string, number>()
for (const r of results) for (const b of r.badFiles) allBad.set(b, (allBad.get(b) ?? 0) + 1)
if (allBad.size > 0) {
  console.log(`\nFILES THAT DEGRADED OR THREW, by width that saw them:`)
  for (const [b, n] of [...allBad].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    const widths = results.filter((r) => r.badFiles.includes(b)).map((r) => r.width)
    console.log(`  ${b}  seen ${n}x at width(s) ${[...new Set(widths)].join(",")}`)
  }
}

const neverCleared = armed.filter((a) => !cleared.has(a.id))
const clearedCount = armed.length - neverCleared.length
console.log(`\nSTALE-BOMB MEASUREMENT (src/ast/engine.ts:1441-1447)`)
console.log(`  120000 ms self-destruct timers ARMED: ${armed.length}   CLEARED: ${clearedCount}   NEVER CLEARED: ${neverCleared.length}`)
console.log(`  armings per parseFile call: ${(armed.length / (sample.length * ROUNDS * ARMS.length)).toFixed(2)} (the engine arms more than one per file; that ratio is engine-internal and is printed, not interpreted)`)
console.log(
  `  engine.ts arms the timer BEFORE parser.parse() and calls clearTimeout AFTER it, so a parse that THROWS leaves its bomb armed.`,
)
if (fired.length === 0) {
  console.log(`  BOMBS THAT FIRED during this run: 0 — the count above is an armed-minus-cleared imbalance, not an observed kill.`)
} else {
  console.log(`  BOMBS THAT FIRED during this run: ${fired.length}   process.exit calls they attempted: ${exitAttempts.length} (stubbed by this probe)`)
  for (const f of fired) {
    console.log(
      `    armed +${((f.firedAt - f.armedAt) / 1000).toFixed(1)}s   FIRED +${((f.firedAt - armed[0]?.armedAt ?? f.armedAt) / 1000).toFixed(1)}s into the run   named: ${f.named}   exit(${f.exitCode})`,
    )
  }
  console.log(
    `  Each one is process.exit(1) in the arbiter. The file it NAMES is whichever armed the oldest`,
  )
  console.log(
    `  surviving bomb — compare it against the [BB-PARSE-ERR] file, which is the file that actually threw.`,
  )
}

// The conclusion is COMPUTED from this run's arms, never asserted. The first version printed the
// literal sentence "the wasm trap appeared at width 8 only" on every run, including runs where
// width 4 had degraded files — so the instrument stated a conclusion its own table contradicted,
// which is the same defect class this lane documents in other lanes' instruments. A width is
// reported as implicated if and only if its own arms saw a degradation or a throw.
const perWidth = ARMS.map((width) => {
  const rs = results.filter((r) => r.width === width)
  return {
    width,
    parsed: rs.reduce((a, r) => a + r.parsed, 0),
    degraded: rs.reduce((a, r) => a + r.degradedFallback, 0),
    threw: rs.reduce((a, r) => a + r.threwOutOfParseFile, 0),
  }
})
const widthBad = (w: (typeof perWidth)[number]) => w.degraded + w.threw
const implicated = perWidth.filter(widthBad).map((w) => w.width)
const cleanArms = perWidth.filter((w) => widthBad(w) === 0).map((w) => w.width)

if (neverCleared.length === 0 && allBad.size === 0) {
  console.log(`\nVERDICT OF THIS PROBE ON THIS RUN: clean. The defect is latent here, not absent.`)
} else {
  console.log(
    `\nVERDICT OF THIS PROBE ON THIS RUN: ${neverCleared.length} orphaned bomb(s), ${fired.length} observed fire(s), ${allBad.size} degraded/throwing file(s).`,
  )
  console.log(`  In the arbiter, any single orphaned bomb ends the run with exit 1 before it prints a verdict.`)
  console.log(
    `  Widths IMPLICATED by this run's own arms: ${implicated.length > 0 ? implicated.join(", ") : "none"}`,
  )
  for (const w of perWidth) {
    console.log(
      `    width ${String(w.width).padEnd(2)} ${String(w.parsed).padEnd(6)} parses  degraded ${String(w.degraded).padEnd(3)} threw ${String(w.threw).padEnd(3)}  ${widthBad(w) > 0 ? "IMPLICATED" : "clean on this run"}`,
    )
  }
  if (cleanArms.length > 0) {
    console.log(`  Widths CLEAN on this run: ${cleanArms.join(", ")}`)
  }
  // The "it is concurrency, not the file" claim is only made when the width-1 arm actually parsed
  // the files that degraded. On a stride sample those files may never have been in the sample at
  // all, and asserting the claim then would be the mirror image of the bug above.
  const sampleLabels = new Set(sample.map(label))
  const badLabels = [...allBad.keys()].map((b) => b.split(" ::")[0])
  const badInSample = badLabels.filter((b) => sampleLabels.has(b))
  const coveredByCleanArms = badLabels.filter((b) => sampleLabels.has(b) && cleanArms.includes(1))
  console.log(
    `  Per-file, not grammar: ${coveredByCleanArms.length} of ${badLabels.length} degraded file(s) were in this sample AND parsed clean at width ${cleanArms.includes(1) ? 1 : "<no clean sequential arm>"}` +
      ` (${badInSample.length} were in the sample at all).`,
  )
  if (cleanArms.includes(1) && coveredByCleanArms.length === badLabels.length) {
    console.log(
      `    So the trap is a property of CONCURRENT parseFile on THIS corpus, not a per-file grammar defect:`,
    )
    console.log(`    every file that degraded under concurrency parsed clean when driven one at a time.`)
  } else {
    console.log(
      `    NOT CLAIMED as a concurrency property on this run: the width-1 arm did not cover every degraded file,`,
    )
    console.log(`    so this run cannot separate "concurrent" from "this particular file".`)
  }
  console.log(
    `  This is an OBSERVED count from ONE run. It is not a rate: a rate quoted for this defect has been an`,
  )
  console.log(
    `  artifact before (this lane's own history), and it moves with the other six agents on the host.`,
  )
}

process.exit(0)

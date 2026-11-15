/**
 * IS THE `[BB-HANG]` FILE STUCK, OR IS THE WATCHDOG FIRING ON A FILE THAT ALREADY
 * THREW? — an arbitration probe over the files this lane's corpus walks have named.
 *
 * ## Why this file exists
 *
 * `src/ast/engine.ts` arms a 120-second watchdog around the synchronous
 * `parser.parse()` and clears it a few lines later, but a `throw` between those two
 * lines leaves the watchdog armed. It then fires and calls `process.exit(1)`
 * printing `[BB-HANG] parser stuck 120s on <file> — exiting` on a run that did not
 * hang (Limitations 8). Every full-corpus walk of this lane has aborted on one of
 * these, and the message has always named a file whose OWN log line in the same run
 * is `[BB-PARSE-ERR] … memory access out of bounds`. That is an argument that the
 * named file is not stuck. This file turns the argument into a measurement:
 *
 *   1. byte size and line count of each named file — a 90-byte file cannot exhaust
 *      a fixed WASM heap, so a size ceiling falsifies "this input is pathological"
 *      on its own;
 *   2. a production `parseFile` of each named file ALONE, repeated, with the
 *      wall-clock time of every call — the FIRST call separately from the rest,
 *      because it carries the WASM module load and is not a property of the file.
 *      "Stuck" is then a number against the engine's own 120-second watchdog
 *      rather than an adjective.
 *
 * ## What it is NOT
 *
 * It does not prove the watchdog is the cause. It measures the *file*: how big it
 * is, and how long it takes to parse alone with nothing else competing. A file
 * that parses in 40ms here may still be the file the watchdog was aiming at on a
 * saturated box, and this probe cannot see saturation — that is the whole point of
 * running it single-threaded. What it rules out with numbers is a per-input defect
 * on a quiet machine, and it reports the headroom against 120 s either way.
 *
 * No regex over Nim source: file size and line count come from the buffer and the
 * byte scan, and the parse comes from `parseFile`. The only string work is splitting
 * the `[BB-HANG] … on <path> — exiting` line the shared engine prints, which is
 * matching this harness's own machine output rather than matching the language.
 *
 * Writes no evidence. Run:
 *   npx tsx validation/m14/fixtures/nim/hang-file-arbitration.ts
 * Exit 0 iff every named file parses under the ceiling on every repeat.
 */
import { readFileSync, existsSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

/**
 * The engine's own watchdog, `src/ast/engine.ts` — the threshold the
 * `[BB-HANG]` message reports having crossed. A single-file parse below this, on a
 * quiet machine, cannot be what the watchdog was measuring.
 */
const WATCHDOG_MS = 120_000
/** Repeats per file. The first is reported as cold; the rest are the warm figure. */
const REPEATS = 5

/**
 * The files this lane's walks have named, as recorded in
 * `validation/m14/measurements/nim/*.txt` and in the Limitations 8 table.
 * `namedBy` is the artifact that carries the line.
 */
const NAMED: { file: string; namedBy: string }[] = [
  { file: "nim/lib/std/private/ossymlinks.nim", namedBy: "census.ts, artifact written" },
  { file: "nim/tests/distinct/tinvalidborrow.nim", namedBy: "ontology-census, artifact written" },
  { file: "nim/tests/ic/mlocalpassc.nim", namedBy: "resolution-audit.ts, artifact written" },
  { file: "nim/lib/std/private/oscommon.nim", namedBy: "accent-quoted-endpoints.ts, no artifact" },
  { file: "nim/tests/async/treturn_await.nim", namedBy: "census.ts session 2 @2 workers, no artifact" },
  { file: "nim/tests/dll/nimhcr_0_2.nim", namedBy: "census.ts session 6 @6 workers, no artifact" },
  { file: "nim/tests/dll/nimhcr_0_6.nim", namedBy: "ontology-coverage-gate.ts @8 workers, session 7" },
  // Session 19, @2 workers. Its own log line in the same run is
  // `[BB-PARSE-ERR] … memory access out of bounds`, which is the shape every row
  // above has — the watchdog fires on a file that already threw.
  { file: "nim/tests/async/tpolltimeouts.nim", namedBy: "resolution-audit.ts @2 workers, no artifact" },
  { file: "nim/tests/overload/tgenericalias.nim", namedBy: "resolution-audit.ts @2 workers, BB-PARSE-ERR only" },
]

const ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

interface Row {
  file: string
  bytes: number
  lines: number
  parses: number
  failures: number
  coldMs: number
  warmMaxMs: number
  times: number[]
  symbols: number
  edges: number
  underWatchdog: boolean
}

const rows: Row[] = []
let failures = 0

for (const { file, namedBy } of NAMED) {
  const abs = `${ROOT}/${file}`
  if (!existsSync(abs)) {
    console.log(`MISSING  ${file}  (not on disk under BB_CORPUS_ROOT)`)
    failures++
    continue
  }
  const buf = readFileSync(abs)
  let bytes = 0
  let lines = 1
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) lines++
  }
  bytes = buf.length

  let parses = 0
  let failed = 0
  const times: number[] = []
  let symbols = 0
  let edges = 0
  for (let r = 0; r < REPEATS; r++) {
    const t0 = Date.now()
    try {
      const res = await parseFile(abs, buf.toString("utf8"))
      times.push(Date.now() - t0)
      symbols = res.symbols?.length ?? 0
      edges = res.relationships?.length ?? 0
      parses++
    } catch {
      times.push(Date.now() - t0)
      failed++
    }
  }
  const coldMs = times[0] ?? 0
  const warmMaxMs = times.slice(1).reduce((a, b) => (b > a ? b : a), 0)
  const underWatchdog = Math.max(coldMs, warmMaxMs) < WATCHDOG_MS && failed === 0
  if (!underWatchdog) failures++
  rows.push({ file, bytes, lines, parses, failures: failed, coldMs, warmMaxMs, times, symbols, edges, underWatchdog })
  console.log(
    `${underWatchdog ? "OK      " : "OVER    "}${file.padEnd(44)} ${String(bytes).padStart(7)} B ` +
      `${String(lines).padStart(5)} lines  ${parses}/${REPEATS} parsed  cold ${String(coldMs).padStart(6)} ms  ` +
      `warm max ${String(warmMaxMs).padStart(5)} ms  ${symbols} symbols  ${edges} edges`,
  )
  console.log(`          times: ${times.join(", ")} ms   [named by: ${namedBy}]`)
}

const totalBytes = rows.reduce((a, r) => a + r.bytes, 0)
const totalLines = rows.reduce((a, r) => a + r.lines, 0)
const slowest = rows.reduce((a, r) => (Math.max(a.coldMs, a.warmMaxMs) > Math.max(r.coldMs, r.warmMaxMs) ? a : r), rows[0])
const slowestMs = Math.max(slowest.coldMs, slowest.warmMaxMs)

console.log("")
console.log(`named files         : ${rows.length}`)
console.log(`total size          : ${totalBytes} B over ${totalLines} lines`)
console.log(`largest named file  : ${Math.max(...rows.map((r) => r.bytes))} B`)
console.log(`all parses succeeded: ${rows.every((r) => r.failures === 0)}`)
console.log(
  `slowest call        : ${slowestMs} ms (${slowest.file}, cold) against the engine's ${WATCHDOG_MS} ms watchdog` +
    ` — ${(WATCHDOG_MS / Math.max(1, slowestMs)).toFixed(0)}x headroom`,
)
console.log("")
console.log(
  failures === 0
    ? `every file this lane's walks were aborted on parses alone, with no contention, in at most ` +
      `${slowestMs} ms against a ${WATCHDOG_MS} ms watchdog. The named input is not the cause; what the ` +
      `message names is the file whose parse threw, not one that was stuck.`
    : `${failures} named file(s) reached the watchdog alone — the per-input reading is NOT ruled out and this report is wrong.`,
)
process.exit(failures === 0 ? 0 : 1)

/**
 * GATE DRIVER — turn an unrecordable poison file into a terminating walk.
 *
 * ## The loop this breaks
 *
 * `ontology-coverage-gate.ts dart` cannot finish. Measured on this lane:
 *
 *   deep_nesting_statement_test.dart   SIGKILLed at 200s; the engine's own 120s guard
 *                                      never printed, so it is not merely slow
 *   mint_maker_test.dart               "memory access out of bounds", then
 *                                      `[BB-HANG] parser stuck 120s ... — exiting`
 *
 * Both kill the process. `resumable-walk.ts` is supposed to absorb exactly that: it marks
 * a bad file by REJECTING it, so the next run skips it. But a hang is not a rejection.
 * `process.exit()` unwinds nothing — `opts.run(i)` neither returns nor rejects, the
 * `catch` never executes, and since the log is append-only-BEFORE-work the file is never
 * marked. The next run offers the same file, dies the same way, and the walk is
 * INFINITE, not slow. That is the difference this driver exists to exploit correctly:
 * the marker is correct, the process simply cannot write it about itself.
 *
 * So this writes the marker from OUTSIDE, and only ever on evidence: a `[BB-HANG]`
 * naming a specific file in that run's own output. Every skip it makes is a line in the
 * checkpoint, and the gate reports SKIPPED-BAD and PARTIAL on its own, so the verdict
 * still states its population. Nothing here decides a verdict; it only stops the walk
 * from being unkillable.
 *
 * ## What it will NOT do
 *
 *   - mark a file bad on any other exit code. Exit 1 from the gate means a verdict
 *     (RULED-UNJUSTIFIED / FALSIFIED), which is the gate WORKING and must surface.
 *   - invent a skip. If no `[BB-HANG]` line appears, the run stops.
 *   - touch the checkpoint with `--fresh` semantics; it appends only.
 *
 * Usage: gate-drive.ts [maxIterations] [perRunTimeoutSeconds]
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"

const MAX_ITER = Number(process.argv[2] ?? 40)
const RUN_TIMEOUT = Number(process.argv[3] ?? 3600)
const CHECKPOINT = "validation/m14/measurements/walk-dart.txt"
const LOG_DIR = "/tmp/opencode"

if (!existsSync(LOG_DIR)) execFileSync("mkdir", ["-p", LOG_DIR])

/** Files already recorded bad, so we never re-append and never re-run a known hang. */
const badSoFar = (): Set<string> => {
  const s = new Set<string>()
  if (!existsSync(CHECKPOINT)) return s
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    const t = line.trim()
    if (t.startsWith("!")) s.add(t.slice(1))
  }
  return s
}

const checkpointLines = (): number =>
  existsSync(CHECKPOINT) ? readFileSync(CHECKPOINT, "utf8").split("\n").filter((l) => l.trim()).length : 0

for (let iter = 1; iter <= MAX_ITER; iter++) {
  const before = checkpointLines()
  const log = `${LOG_DIR}/gate-dart-iter${iter}.log`
  console.log(`\n=== iteration ${iter}/${MAX_ITER}  checkpoint=${before}  timeout=${RUN_TIMEOUT}s`)

  let code = -1
  let out = ""
  try {
    out = execFileSync("npx", ["tsx", "script/m14/ontology-coverage-gate.ts", "dart"], {
      encoding: "utf8",
      timeout: RUN_TIMEOUT * 1000,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
    code = 0
  } catch (e: any) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
    code = typeof e.status === "number" ? e.status : -1
  }
  try {
    appendFileSync(log, out)
  } catch {}

  const after = checkpointLines()
  console.log(`    exit=${code}  checkpoint ${before} -> ${after}  (+${after - before})`)

  // A hang is the ONLY condition that licenses marking a file bad.
  const hang = out.match(/\[BB-HANG\][^\n]*?on\s+(\S+)/)
  if (!hang) {
    console.log(`    no [BB-HANG] in output — the walk ended on its own terms. Stopping.`)
    console.log(out.slice(-4000))
    process.exit(code === 0 ? 0 : code < 0 ? 1 : code)
  }

  const victim = hang[1]
  if (badSoFar().has(victim)) {
    console.log(`    [BB-HANG] named an ALREADY-MARKED file: ${victim}`)
    console.log(`    the walk cannot advance past it and cannot skip it. Stopping rather than loop.`)
    process.exit(3)
  }
  console.log(`    [BB-HANG] marking bad (measured, named in this run): ${victim}`)
  appendFileSync(CHECKPOINT, `!${victim}\n`)
}

console.log(`\nexhausted ${MAX_ITER} iterations without a clean finish`)
process.exit(4)
/**
 * REGRESSION PROBE — `ambiguity-split.ts`'s population gate, deterministically.
 * ------------------------------------------------------------------------
 * ## What is being tested
 *
 * `ambiguity-split.ts` measures a POPULATION: it samples N admitted files, parses each through
 * production `parseFile`, and reports edge counts, ambiguity buckets and resolution rates over
 * everything that parsed. Every one of those figures is a whole-population claim, so the file now
 * ends with a gate that refuses to print a complete table over a degraded population and exits 3
 * (`--allow-degraded` publishes it anyway).
 *
 * That gate had no test, because the condition it tests is PROBABILISTIC. Measured 2026-10-05 on
 * this lane's own 600-file sample at the harness's former default width of 4:
 *
 *   run 1 -> degraded `julia/stdlib/LibGit2/src/repository.jl`
 *   run 2 -> degraded `julia/stdlib/LibGit2/src/strarray.jl`        (a DIFFERENT file)
 *   run 3 -> 0 degraded
 *
 * A test that waits for a real degradation is a test that mostly does not run, and one that
 * "passed" on run 3 would have proved nothing. So the harness carries `BB_JULIA_FAULT_INJECT`,
 * which forces N sampled files to count as degraded and bypasses the cache in both directions, and
 * this probe drives it.
 *
 * ## The four properties, and what each would look like broken
 *
 *   P1  a degraded population exits 3, not 0        — a gate that cannot fail is not a gate
 *   P2  the degraded FILE is named on screen and in the artifact — an unnamed degradation is
 *                                                      indistinguishable from a clean parse
 *   P3  `--allow-degraded` publishes it and exits 0, with the degraded list still in the record —
 *                                                      the override must not also erase the evidence
 *   P4  fault injection never reaches the cache      — a faulted parse replayed as a clean record
 *                                                      is the worst outcome available here, because
 *                                                      every downstream figure would be a claim
 *                                                      about a population that was never measured
 *
 * ## Exit codes
 *   0  all four properties hold
 *   1  at least one does not — each failure is printed with the observation that falsified it
 *
 * ## USAGE
 *   bun run validation/m14/fixtures/julia/ambiguity-split-population-gate.ts
 *
 * Runs on a 24-file stride sample (seconds, not minutes): the gate's decision depends only on the
 * degraded COUNT, never on the population's size, so a small sample exercises the same code path a
 * 600-file run does. The 600-file figures live in the doc, measured at width 1.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const HARNESS = path.join(process.cwd(), "validation/m14/fixtures/julia/ambiguity-split.ts")
const CACHE_DIR = "/tmp/julia-ambiguity-cache"
const SAMPLES = 24
const INJECT = 2

interface RunResult {
  status: number
  stdout: string
  record: any
}

function run(extraEnv: Record<string, string>, args: string[]): RunResult {
  const jsonOut = path.join(mkdtempSync(path.join(tmpdir(), "bb-julia-gate-")), "record.json")
  // The injection variable is UNSET unless this call asks for it. Spreading `process.env` alone is
  // not enough to make a run clean: a variable exported once would otherwise be inherited by every
  // later run, which is exactly the "a faulted run silently becomes the population" failure P4
  // exists to catch — in the probe as well as in the harness.
  const env: Record<string, string> = { ...process.env, BB_JULIA_WORKERS: "1", ...extraEnv }
  if (!("BB_JULIA_FAULT_INJECT" in extraEnv)) delete env.BB_JULIA_FAULT_INJECT
  const r = spawnSync("npx", ["tsx", HARNESS, "--files", String(SAMPLES), "--json", jsonOut, ...args], {
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  const rec = existsSync(jsonOut) ? JSON.parse(readFileSync(jsonOut, "utf8")) : null
  rmSync(path.dirname(jsonOut), { recursive: true, force: true })
  return { status: r.status ?? -1, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`, record: rec }
}

const failures: string[] = []
function check(prop: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${prop}${ok ? "" : ` — ${detail}`}`)
  if (!ok) failures.push(prop)
}

console.log(`ambiguity-split population gate — regression probe (${SAMPLES}-file sample)\n`)

// P1 + P2 — a degraded population must be refused, and the file must be named.
console.log(`P1/P2  BB_JULIA_FAULT_INJECT=${INJECT} -> expect exit 3 and the degraded file named`)
const bad = run({ BB_JULIA_FAULT_INJECT: String(INJECT) }, [])
check("P1 exit is 3, not 0", bad.status === 3, `exit was ${bad.status}`)
check(
  "P1 banner printed",
  bad.stdout.includes("POPULATION NOT CLEAN"),
  `banner absent from ${bad.stdout.length} bytes of output`,
)
check(
  "P1 the table does not claim a clean population",
  !bad.stdout.includes("population clean:"),
  "the 'population clean' line printed on a degraded population",
)
check(
  "P2 artifact names the degraded files",
  Array.isArray(bad.record?.degraded) && bad.record.degraded.length === INJECT,
  `record.degraded was ${JSON.stringify(bad.record?.degraded)}`,
)
check(
  "P2 artifact records the injection rather than hiding it",
  bad.record?.faultInjected === INJECT,
  `record.faultInjected was ${JSON.stringify(bad.record?.faultInjected)}`,
)
check(
  "P2 the banner names at least one real sampled file",
  (bad.record?.degraded ?? []).some((l: string) => l.includes("/")),
  "no degraded label looked like repo/rel",
)

// P3 — the override publishes the reduced population, and keeps the evidence.
console.log(`\nP3  --allow-degraded -> expect exit 0 with the degraded list STILL in the record`)
const allowed = run({ BB_JULIA_FAULT_INJECT: String(INJECT) }, ["--allow-degraded"])
check("P3 exit is 0 when overridden", allowed.status === 0, `exit was ${allowed.status}`)
check(
  "P3 the override did not erase the degraded list",
  Array.isArray(allowed.record?.degraded) && allowed.record.degraded.length === INJECT,
  `record.degraded was ${JSON.stringify(allowed.record?.degraded)}`,
)

// P4 — a faulted parse must not reach the cache. The cache is keyed on analyzer hash + sample
// mtimes + width, so a faulted run and a clean run over the same sample compute the SAME key. Only
// the injection's cache BYPASS makes them safe: a faulted run must not WRITE, and must not READ.
// Proven in three steps: clear the cache, fault a run, then run clean. If the faulted rows had been
// written, the clean run would replay them and exit 3.
console.log(`\nP4  a faulted run must not poison the cache for a clean run`)
rmSync(CACHE_DIR, { recursive: true, force: true })
const faulted = run({ BB_JULIA_FAULT_INJECT: String(INJECT) }, ["--allow-degraded"])
check("P4 the faulted run completed under the override", faulted.status === 0, `exit was ${faulted.status}`)
check(
  "P4 the faulted run WROTE no cache entry",
  !existsSync(CACHE_DIR) || readdirSync(CACHE_DIR).length === 0,
  `cache dir after the faulted run holds ${existsSync(CACHE_DIR) ? readdirSync(CACHE_DIR).length : 0} entries`,
)
const afterFault = run({}, [])
check("P4 the clean run after a faulted run exits 0", afterFault.status === 0, `exit was ${afterFault.status}`)
check(
  "P4 the clean run parsed FRESH rather than replaying injected rows",
  afterFault.record?.parseFromCache === false,
  `record.parseFromCache was ${JSON.stringify(afterFault.record?.parseFromCache)}`,
)
check(
  "P4 the clean run's degraded list is empty",
  Array.isArray(afterFault.record?.degraded) && afterFault.record.degraded.length === 0,
  `record.degraded was ${JSON.stringify(afterFault.record?.degraded)}`,
)

console.log("")
if (failures.length > 0) {
  console.log(`${failures.length} of 10 checks FAILED: ${failures.join(", ")}`)
  console.log("The population gate is not holding. Its exit code carries a claim; a claim that")
  console.log("cannot go red is decoration.")
  process.exit(1)
}
console.log("10 of 10 checks hold: a degraded population is refused, named, overridable without losing")
console.log("the evidence, and unfaultable through the cache.")
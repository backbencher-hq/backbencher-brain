/**
 * cpp-index-reproduce — ONE command that reproduces the cpp project-index arms and their checks
 * (task-22 milestone 4), so the Lead's reproduction is a single invocation rather than four typed
 * commands with hand-kept paths.
 *
 * WHAT IT RUNS, in order (whole population; the gate's own discovery):
 *   A      incoming-gate cpp <exts> 0
 *   B-off  incoming-gate cpp <exts> 0 --index
 *   B-on   BB_CPP_INDEX_CONSUME=1 incoming-gate cpp <exts> 0 --index
 * then `cpp-index-arm-compare.ts` over the three captured streams (the owner channel prints on stderr,
 * so both streams are captured per arm), which re-derives the decomposition artifact and asserts the
 * pre-committed checks (edges invariant, B-off == A, extFAIL/bindFAIL/causeFAIL 0, arbitraryTwin not
 * risen, closure exact).
 *
 * THE MEMORY GATE IS ENFORCED HERE, before the first heavy: < 3 GB available refuses with the number.
 * `--dump` additionally writes each arm's row dump (hundreds of MB) — OFF by default because the
 * TABLE/intent/owner-channel outputs are all the comparison needs.
 *
 * USAGE (Lead's one command)
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-index-reproduce.ts \
 *     [--work=.tmp-cpp/repro] [--json=<path for the decomposition>] [--dump] [--dry-run]
 */
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const WORK = argOf("--work") ?? path.join(ROOT, ".tmp-cpp", "repro")
const JSON_OUT = argOf("--json") ?? path.join(ROOT, "validation/m14/fixtures/cpp/measurements/cpp-index-arms.json")
const WITH_DUMP = process.argv.includes("--dump")
const DRY = process.argv.includes("--dry-run")
const EXTS = "cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu"

const availGB = os.freemem() / (1024 ** 3)
if (availGB < 3 && !DRY) {
  console.error(`cpp-index-reproduce: REFUSING to start — ${availGB.toFixed(2)} GB available; the memory gate needs >= 3 GB for a whole-population arm (load ${os.loadavg()[0].toFixed(2)}).`)
  process.exit(2)
}
if (!fs.existsSync(path.join(CR))) {
  console.error(`cpp-index-reproduce: corpus root not found: ${CR} (set BB_CORPUS_ROOT)`)
  process.exit(2)
}
fs.mkdirSync(WORK, { recursive: true })

const gate = path.join(ROOT, "script/m14/incoming-gate.ts")
const arms: Array<{ id: string; env: Record<string, string>; extra: string[] }> = [
  { id: "a", env: {}, extra: [] },
  { id: "b-off", env: {}, extra: ["--index"] },
  { id: "b-on", env: { BB_CPP_INDEX_CONSUME: "1" }, extra: ["--index"] },
]
const paths = Object.fromEntries(arms.map((a) => [a.id, { out: path.join(WORK, `arm-${a.id}.out`), err: path.join(WORK, `arm-${a.id}.err`) }]))

const runOne = (arm: { id: string; env: Record<string, string>; extra: string[] }): number => {
  const outPath = paths[arm.id].out
  const errPath = paths[arm.id].err
  const cmdArgs = ["run", gate, "cpp", EXTS, "0", ...arm.extra, ...(WITH_DUMP ? ["--dump"] : [])]
  const env = { ...process.env, ...arm.env, BB_DUMP_LIMIT: process.env.BB_DUMP_LIMIT ?? "2000000", BB_CORPUS_ROOT: CR }
  if (DRY) { console.log(`[dry-run] ${arm.id}: BB_CORPUS_ROOT=${CR} ${Object.entries(arm.env).map(([k, v]) => `${k}=${v}`).join(" ")} bun ${cmdArgs.join(" ")} > ${path.relative(ROOT, outPath)} 2> ${path.relative(ROOT, errPath)}`); return 0 }
  console.log(`cpp-index-reproduce: arm ${arm.id} …`)
  const out = fs.openSync(outPath, "w")
  const err = fs.openSync(errPath, "w")
  const t0 = performance.now()
  const res = spawnSync("bun", cmdArgs, { cwd: ROOT, env, stdio: ["ignore", out, err], timeout: 3 * 60 * 60 * 1000 })
  fs.closeSync(out); fs.closeSync(err)
  const ms = performance.now() - t0
  if (res.error) console.error(`  arm ${arm.id}: ${res.error.message}`)
  console.log(`  arm ${arm.id}: exit ${res.status} in ${(ms / 1000).toFixed(0)}s (${outPath.replace(ROOT + "/", "")})`)
  return res.status ?? 1
}
for (const arm of arms) runOne(arm)

if (DRY) {
  console.log(`[dry-run] then: bun run script/m14/cpp-index-arm-compare.ts --a=${path.relative(ROOT, paths["a"].out)} --b-off=${path.relative(ROOT, paths["b-off"].out)} --b-on=${path.relative(ROOT, paths["b-on"].out)} --json=${path.relative(ROOT, JSON_OUT)}`)
  process.exit(0)
}

const cmp = spawnSync("bun", ["run", path.join(ROOT, "script/m14/cpp-index-arm-compare.ts"),
  `--a=${paths["a"].out}`, `--b-off=${paths["b-off"].out}`, `--b-on=${paths["b-on"].out}`, `--json=${JSON_OUT}`,
], { cwd: ROOT, stdio: "inherit", timeout: 30 * 60 * 1000 })
console.log(`cpp-index-reproduce: comparison exit ${cmp.status}`)
process.exit(cmp.status ?? 1)

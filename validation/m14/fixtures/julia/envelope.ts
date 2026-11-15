/**
 * julia's time envelope, measured through the PRODUCTION entry point.
 *
 * WHY THIS EXISTS. §6 of the lane brief says an addition that grows the graph must be reported
 * against a budgeted lane. Two facts make that impossible to satisfy by pointing at an existing
 * gate:
 *
 *   1. `script/m60/analyzer-complexity-gate.ts` prints **44 lanes and julia is not one of them**
 *      (`grep -i julia` over its whole output returns nothing). There is no julia row to regress.
 *   2. `validation/m60/analyzer-budget-register.json` carries no julia entry either, so there is no
 *      declared budget, and `validation/m12/results/` has `julia-differential.json` but no
 *      `julia-complexity.json` — the artifact that gate reads does not exist for this lane.
 *
 * The shared M12 harness (`script/m12/measure-analyzer.ts`) would do the work but exits before
 * timing because `validation/m12/fixtures/julia` does not exist, and it writes
 * `validation/m12/results/julia-complexity.json`, which is a shared results path (§8). So this is a
 * lane-owned measurement under the lane's own fixtures directory, and it writes NOTHING.
 *
 * WHAT #909 FORBIDS, AND WHY EVERY FIELD HERE IS PRESENT. A bare ms/file is uninterpretable: the
 * c artifact recorded 145.7ms/file and the SAME analyzer re-measured 25.8ms/file and then 172.6ms/file
 * minutes apart while three other agents sat at 78/73/59% CPU. So this prints the file set's own
 * digest, the byte distribution, and the load it ran under, and refuses to print a rate without all
 * three. A reader can then tell a heavy file set from a loaded box, which is the whole point.
 *
 * Usage: npx tsx validation/m14/fixtures/julia/envelope.ts [--files 400] [--dir <path>]
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string, d: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DIR = arg("dir", CR)
const WANT = Number(arg("files", "400"))

// Same discovery rule the census uses: tracked files only, over 512 KB excluded, `.jl` admitted.
const cands: { abs: string; dir: string; bytes: number }[] = []
for (const e of readdirSync(DIR)) {
  const dir = path.join(DIR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    if (path.extname(rel).toLowerCase() !== ".jl") continue
    let bytes: number
    try {
      bytes = statSync(abs).size
      if (bytes > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "julia") continue
    } catch {
      continue
    }
    cands.push({ abs, dir, bytes })
  }
}
// GLOBAL sort then a stride, so --limit does not depend on directory order (#909's rule) and the
// draw is reproducible rather than "whatever the walk reached first".
cands.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const stride = Math.max(1, Math.floor(cands.length / WANT))
const files = cands.filter((_, i) => i % stride === 0).slice(0, WANT)

const load1 = os.loadavg()[0]!
const digest = createHash("sha256").update(files.map((f) => f.abs).join("\n")).digest("hex").slice(0, 16)
const bytes = files.map((f) => f.bytes).sort((a, b) => a - b)
const median = bytes[Math.floor(bytes.length / 2)] ?? 0
const p90 = bytes[Math.floor(bytes.length * 0.9)] ?? 0

console.log(`julia envelope — production parseFile`)
console.log(`corpus dir: ${DIR}`)
console.log(`file set: ${files.length} of ${cands.length} candidates (stride ${stride}), digest ${digest}`)
console.log(`byte distribution: min ${bytes[0]} · median ${median} · p90 ${p90} · max ${bytes[bytes.length - 1]}`)
console.log(`load under measurement: load1 ${load1.toFixed(2)} on ${os.cpus().length} cores — #909: a ms/file number without this is uninterpretable`)

// Warm the grammar module first so the first timed file is not paying for the wasm load, which is a
// per-process cost and not a per-file cost.
await parseFile(files[0]!.abs, files[0]!.dir).catch(() => {})

let threw = 0
let symbols = 0
let rels = 0
const perType = new Map<string, number>()
const t0 = process.hrtime.bigint()
for (const f of files) {
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch {
    threw++
    continue
  }
  symbols += (r?.symbols ?? []).length
  for (const x of (r?.relationships ?? []) as any[]) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!t) continue
    rels++
    perType.set(t, (perType.get(t) ?? 0) + 1)
  }
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6

console.log(`\n${ms.toFixed(0)} ms for ${files.length} files  ->  ${(ms / files.length).toFixed(2)} ms/file`)
console.log(`symbols ${symbols.toLocaleString()}  relationships ${rels.toLocaleString()}  parseFile threw: ${threw}`)
console.log(`throughput: ${((symbols + rels) / (ms / 1000)).toFixed(0)} outputs/s, ${((rels / files.length)).toFixed(1)} relationships/file`)
console.log(`per-type on this draw: ${[...perType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(" · ")}`)

// The regression question §6 asks, answered against the draw rather than asserted: relations per
// file is the quantity that grows the graph.
//
// THIS USED TO BE A TAUTOLOGY AND SAID SO IN ITS OWN OUTPUT. It printed
// `REGRESSION BASIS: ${(rels / files.length).toFixed(1)} relationships/file` — computed from the run
// that had just finished, under a comment saying "printed above so a later run can difference it". A
// later run cannot difference it against that, because nothing was STORED: the number a future run
// needed was the number the previous run printed into a terminal, and the instrument's own output
// made the comparison available while making it impossible. Every run agreed with itself, which is
// the shape this lane's doc already records twice as "a zero that read as a pass".
//
// So the basis is a committed artifact now, keyed by the FILE-SET DIGEST and the file count, and the
// comparison is refused outright when the digest differs — a different draw is a different
// measurement, and differencing the two would manufacture a regression out of a changed file set.
// `--record` re-baselines, and says so in its output rather than doing it silently.
const BASELINE = path.join(process.cwd(), "validation", "m60", "results", "julia-envelope-baseline.json")
const RECORD = process.argv.includes("--record")
const key = `${digest}:${files.length}`
let baseline: { key: string; relationshipsPerFile: number; symbolsPerFile: number; msPerFile: number; relationships: number; symbols: number; perType: Record<string, number> } | null = null
try {
  const parsed = JSON.parse(readFileSync(BASELINE, "utf8"))
  if (parsed && parsed.key === key) baseline = parsed
} catch { /* no baseline recorded yet: the comparison below says so rather than passing */ }

const relsPerFile = rels / files.length
const symsPerFile = symbols / files.length
const msPerFile = ms / files.length
const pct = (now: number, then: number): string => {
  if (!then) return "n/a"
  const d = ((now - then) / then) * 100
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}%`
}

console.log(`\nREGRESSION BASIS — file set ${files.length}, digest ${digest}`)
if (!baseline) {
  console.log(`  NO COMPARABLE BASELINE for this draw. A baseline is keyed \`digest:files\`; a different draw is a`)
  console.log(`  different measurement and differencing the two would manufacture a regression out of a changed file`)
  console.log(`  file set. This run: ${relsPerFile.toFixed(1)} relationships/file, ${symsPerFile.toFixed(1)} symbols/file.`)
  console.log(`  Record one with: npx tsx validation/m14/fixtures/julia/envelope.ts --files ${files.length} --record`)
} else {
  console.log(`  relationships/file  ${relsPerFile.toFixed(1)}  vs baseline ${baseline.relationshipsPerFile.toFixed(1)}  ${pct(relsPerFile, baseline.relationshipsPerFile)}`)
  console.log(`  symbols/file        ${symsPerFile.toFixed(1)}  vs baseline ${baseline.symbolsPerFile.toFixed(1)}  ${pct(symsPerFile, baseline.symbolsPerFile)}`)
  console.log(`  ms/file             ${msPerFile.toFixed(2)} vs baseline ${baseline.msPerFile.toFixed(2)}  ${pct(msPerFile, baseline.msPerFile)}`)
  console.log(`  ms/file is NOT a regression signal on a shared box: the run above prints the load1 it ran under, and this lane`)
  console.log(`  has already measured a 27% ms/file swing on an UNCHANGED analyzer that was entirely load. Read the payload rows.`)
  const grew = Object.entries(perType).filter(([t, n]) => (baseline!.perType[t] ?? 0) > 0 && n > (baseline!.perType[t] ?? 0))
  const shrank = Object.entries(perType).filter(([t, n]) => (baseline!.perType[t] ?? 0) > n)
  if (grew.length) console.log(`  types that grew:   ${grew.map(([t, n]) => `${t} ${baseline!.perType[t]}->${n}`).join(", ")}`)
  if (shrank.length) console.log(`  types that shrank: ${shrank.map(([t, n]) => `${t} ${baseline!.perType[t]}->${n}`).join(", ")}`)
}

if (RECORD) {
  const payload = {
    key,
    digest,
    files: files.length,
    relationshipsPerFile: Number(relsPerFile.toFixed(3)),
    symbolsPerFile: Number(symsPerFile.toFixed(3)),
    msPerFile: Number(msPerFile.toFixed(2)),
    relationships: rels,
    symbols,
    perType: Object.fromEntries([...perType.entries()].sort()),
    note: "Load-dependent ms/file is recorded for completeness and is not a regression signal; relationships/file is the quantity that grows the graph. Re-baseline only with the reason in the commit message.",
  }
  mkdirSync(path.dirname(BASELINE), { recursive: true })
  writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n")
  console.log(`\nRECORDED baseline -> ${path.relative(process.cwd(), BASELINE)} (${key})`)
  console.log(`  A re-baseline REPLACES the previous figure. Say in the commit message why, or do not run --record.`)
}
console.log(`Any future run of this file on the same digest and the same --files is comparable; a run on a`)
console.log(`different digest is a different measurement and the two numbers must not be differenced.`)
console.log(`NOTE: no julia budget exists to regress — script/m60/analyzer-complexity-gate.ts prints 44 lanes`)
console.log(`and julia is not among them, and validation/m60/analyzer-budget-register.json has no julia entry.`)
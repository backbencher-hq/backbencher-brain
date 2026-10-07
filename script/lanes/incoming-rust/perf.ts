/**
 * INCOMING_RUST payload/latency check — the lane's own, run after adding edges.
 *
 * ## WHAT IT MEASURES, AND WHY IT IS NOT THE M60 MATRIX
 *
 * `script/m60/payload-matrix.ts` answers "which payload FIELDS reach which
 * seam". This lane's additions declare no new field — `overrides` uses the
 * existing source/target/type/confidence/line_number/metadata slots, and the one
 * new metadata key (`constructorSpelling`) lives inside `metadata`, which is
 * already carried — so the matrix's cell for rust is unchanged by construction.
 *
 * What the additions CAN change is cost: `extractRustTraitImplOverrides` is a
 * second tree walk per file, and the deferred bare-constructor filter now reads a
 * per-symbol shape map. The declared budget for this lane is the M12 envelope —
 * fixtures < 2 s, a 400-file corpus < 60 s — i.e. 150 ms/file. This script
 * measures the real production path (`ASTEngine.parseFile`, parse included) and
 * measures it twice: with the new work present, and with the new call sites
 * removed by a temporary source edit, so the DELTA is measured rather than
 * argued.
 *
 * ## TWO THINGS THIS SCRIPT GETS RIGHT THAT A NAIVE TIMING DOES NOT
 *
 * 1. THE ARMS RUN IN SEPARATE PROCESSES. `bun` caches an imported module for the
 *    life of the process, so editing the analyzer on disk and measuring again in
 *    the same process measures the OLD code and reports "0 extra edges" with a
 *    delta of pure noise. Each arm is a child process.
 * 2. PER-FILE MINIMUM OVER N PASSES. The box this ran on carries a load average
 *    of 28 on 8 cores (other agent sessions), which inflates the mean by more
 *    than any change under test: one file measured 4.4 s in the first pass. The
 *    differential's own harness re-times under load and keeps the MINIMUM for
 *    exactly this reason, and so does this one — a per-file minimum converges to
 *    steady-state cost under any load profile.
 *
 * The temporary edit is applied with the same discipline as `mutants.ts`: to the
 * original bytes, restored in a `finally`, and the file compared byte-for-byte
 * before the script can exit 0.
 *
 * ## NO REGEX
 * Tree walks, `performance.now()` arithmetic and string comparison.
 *
 * Usage: bun script/lanes/incoming-rust/perf.ts [corpusName] [passes]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, readFileSync as rf } from "node:fs"
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const ANALYZER = path.join(REPO_ROOT, "src", "ast", "real-rust-analyzer.ts")
const SELF = path.join(REPO_ROOT, "script", "lanes", "incoming-rust", "perf.ts")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const isArm = process.argv.includes("--arm")
const arm = process.argv.includes("--arm-without") ? "without" : "with"
const corpusName = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "ripgrep"
const PASSES = Number(process.env.BB_PERF_PASSES ?? 3)

const original = readFileSync(ANALYZER, "utf8")

const EDITS = [
  { anchor: "    this.extractRustTraitImplOverrides(rootNode, ctx)", replacement: "    // PERF-PROBE: the overrides pass is removed for the baseline arm" },
  {
    anchor: "        if (cand.bareSpelling) {\n          const owners = tupleConstructible.get(cand.target)",
    replacement: "        if (false) {\n          const owners = tupleConstructible.get(cand.target)",
  },
]

/** Apply the arm's edit (or none) and return a restore function. */
function armSource(): { source: string; restore: () => void; note: string } {
  if (arm === "with") {
    return { source: original, restore: () => writeFileSync(ANALYZER, original), note: "new work present" }
  }
  let mutated = original
  for (const e of EDITS) {
    const at = mutated.indexOf(e.anchor)
    if (at < 0) throw new Error(`perf probe: anchor not found: ${JSON.stringify(e.anchor.slice(0, 70))}`)
    if (mutated.indexOf(e.anchor, at + 1) >= 0) throw new Error(`perf probe: anchor not unique`)
    mutated = mutated.slice(0, at) + e.replacement + mutated.slice(at + e.anchor.length)
  }
  writeFileSync(ANALYZER, mutated)
  return { source: mutated, restore: () => writeFileSync(ANALYZER, original), note: "new call sites removed" }
}

if (isArm) {
  // ---- child process: measure one arm and print a machine-readable line ----
  const repoDir = path.join(CR, corpusName)
  const tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n").filter((f) => f.endsWith(".rs"))
  const pin = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const corpus: { abs: string; content: string }[] = []
  for (const rel of tracked) {
    const abs = path.join(repoDir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      corpus.push({ abs, content: rf(abs, "utf8") })
    } catch { /* unreadable: skipped by every lane instrument alike */ }
  }
  const applied = armSource()
  try {
    const { ASTEngine } = await import(path.join(REPO_ROOT, "src", "ast", "engine.ts"))
    const min = new Array<number>(corpus.length).fill(Number.POSITIVE_INFINITY)
    let edges = 0
    let syms = 0
    for (let pass = 0; pass < PASSES; pass++) {
      for (let i = 0; i < corpus.length; i++) {
        const t0 = performance.now()
        const res = await ASTEngine.parseFile(corpus[i].abs, corpus[i].content)
        const dt = performance.now() - t0
        if (dt < min[i]) min[i] = dt
        if (pass === 0) { edges += (res.relationships ?? []).length; syms += (res.symbols ?? []).length }
      }
    }
    const sorted = [...min].sort((a, b) => a - b)
    const total = min.reduce((a, b) => a + b, 0)
    const avg = total / min.length
    const p50 = sorted[Math.floor(sorted.length * 0.5)]
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    console.log(`ARM\t${arm}\t${corpus.length}\t${edges}\t${syms}\t${total.toFixed(0)}\t${avg.toFixed(2)}\t${p50.toFixed(2)}\t${p95.toFixed(2)}\t${sorted[sorted.length - 1].toFixed(2)}\t${pin}`)
  } finally {
    applied.restore()
  }
  process.exit(0)
}

// ---- driver: spawn both arms, each in its own process ----
const pad = (s: string | number, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
const loadavg = rf("/proc/loadavg", "utf8").split(" ").slice(0, 3).join(" ")
const cores = execFileSync("nproc", { encoding: "utf8" }).trim()

console.log(`payload/latency — ${corpusName}, production ASTEngine.parseFile, per-file MINIMUM over ${PASSES} passes`)
console.log(`machine: load average ${loadavg} on ${cores} cores (the differential re-times under load for this reason)\n`)

function runArm(which: string): any[] {
  const out = execFileSync("bun", [SELF, corpusName, "--arm", which === "with" ? "--arm-with" : "--arm-without"], {
    cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  })
  const line = out.split("\n").find((l) => l.startsWith("ARM\t"))
  if (!line) throw new Error(`no ARM line from the ${which} arm:\n${out}`)
  return line.split("\t")
}

const results: Record<string, any[]> = {}
// The arm ORDER is switchable because a loaded box can put the noise floor
// wherever it likes: if the delta flips sign when the order is reversed, the
// delta was the machine and not the code. `BB_PERF_ORDER=reverse` measures the
// baseline arm first.
const ORDER = process.env.BB_PERF_ORDER === "reverse" ? ["without", "with"] : ["with", "without"]
try {
  for (const which of ORDER) results[which] = runArm(which)
} finally {
  writeFileSync(ANALYZER, original)
}

console.log(`${pad("arm", 10)}${pad("files", 7)}${pad("edges", 8)}${pad("total", 10)}${pad("avg ms/file", 13)}${pad("p50", 9)}${pad("p95", 9)}max`)
for (const which of ["with", "without"]) {
  const [, a, files, edges, , total, avg, p50, p95, max] = results[which]
  console.log(`${pad(which, 10)}${pad(files, 7)}${pad(edges, 8)}${pad((Number(total) / 1000).toFixed(2) + "s", 10)}${pad(avg + "ms", 13)}${pad(p50 + "ms", 9)}${pad(p95 + "ms", 9)}${max}ms`)
}

const avgNew = Number(results.with[6])
const avgOld = Number(results.without[6])
const edgesNew = Number(results.with[3])
const edgesOld = Number(results.without[3])
const BUDGET_MS_PER_FILE = 150 // M12 envelope: a 400-file corpus < 60 s
console.log(`\narm order: ${ORDER.join(" then ")}${process.env.BB_PERF_ORDER === "reverse" ? " (reversed — compare the delta with the other order before believing it)" : ""}`)
console.log(`edges: ${edgesOld} -> ${edgesNew} (${edgesNew - edgesOld >= 0 ? "+" : ""}${edgesNew - edgesOld})`)
console.log(`per-file cost: ${avgOld}ms -> ${avgNew}ms ` +
  `(${avgNew - avgOld >= 0 ? "+" : ""}${(avgNew - avgOld).toFixed(2)}ms, ${avgOld > 0 ? (((avgNew - avgOld) / avgOld) * 100).toFixed(1) : "n/a"}%)`)
const p50New = Number(results.with[7])
const p50Old = Number(results.without[7])
console.log(`median (p50) cost: ${p50Old}ms -> ${p50New}ms (${p50New - p50Old >= 0 ? "+" : ""}${(p50New - p50Old).toFixed(2)}ms) — ` +
  `the robust figure on a loaded box; the MEAN above moves by tens of ms when the arm\n` +
  `order changes, which is the machine, not the code. Compare BOTH orders before\n` +
  `believing a mean delta.`)
console.log(`edge note: the "without" arm removes BOTH features' guards, so it is not the pre-lane\n` +
  `state — it also drops the bare-constructor filter's own conditions and so OVER-emits\n` +
  `(a bare callee naming any in-file type). It is a cost baseline, not a correctness one.`)
console.log(`declared budget ${BUDGET_MS_PER_FILE} ms/file (M12: a 400-file corpus < 60 s); measured ${avgNew}ms = ${((avgNew / BUDGET_MS_PER_FILE) * 100).toFixed(1)}% of budget`)

const restored = readFileSync(ANALYZER, "utf8") === original
console.log(`\nanalyzer source restored byte-identical: ${restored}`)
if (!restored) {
  console.error("the analyzer on disk differs from the bytes this run started with — restore from git before trusting these numbers")
  process.exit(4)
}
if (avgNew > BUDGET_MS_PER_FILE) {
  console.error("\nOVER BUDGET against the M12 envelope — REPORTED, not re-baselined.")
  process.exit(5)
}
console.log("within the declared envelope")
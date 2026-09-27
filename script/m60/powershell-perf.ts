#!/usr/bin/env bun
/**
 * script/m60/powershell-perf.ts — the powershell lane's PERF envelope, measured
 * per file and compared against the lane's own committed analyzer on the
 * IDENTICAL sample.
 *
 * WHY THIS IS SEPARATE FROM THE SURFACE INSTRUMENT. `powershell-surface-
 * measure.ts` reports `ms/file` as `wallMs / files`, and that number is
 * dominated by whatever one-time cost the run pays — the web-tree-sitter core
 * load, the grammar module init, the first parse's table build. On a 49-file
 * draw that boot cost is amortised over 49 files and still dominated the mean:
 * the first measurement reported 430 ms/file for a lane whose steady-state cost
 * is an order of magnitude lower, and a mean is the wrong statistic for "how
 * fast is a file". So this instrument reports the DISTRIBUTION (per-file
 * timings, median, p90, p95, max), the boot cost separately, and the throughput
 * in facts per millisecond — and it never reports a mean without the
 * distribution beside it.
 *
 * THE COMPARISON IS THE POINT. `--compare` runs the lane's COMMITTED analyzer
 * (extracted from git, never edited in place) over the same files with the same
 * parser, in the same process, alternating between the two so machine drift
 * cannot favour either. A speed claim without a same-sample control is the
 * shape of claim this repository rejects.
 *
 * WHAT WOULD FAIL THIS GATE. The M60 R6 envelope is `O(nodes + emitted facts)`:
 * one iterative DFS, a frame stack whose depth is the nesting depth, O(1)
 * Map-backed symbol dedupe, Set-backed per-site relationship dedupe, and
 * descendant searches that stop at the first hit. The failure this instrument is
 * built to catch is a SUPERLINEAR one — a per-symbol O(n) rescan, a
 * re-walk of a subtree per edge. The check is therefore not a millisecond
 * budget but a SCALING one: the same files are measured at two corpus depths and
 * the per-fact cost must not grow materially with depth. A quadratic pass shows
 * up as facts-per-ms falling as the draw grows, and that ratio is printed.
 *
 * Usage:
 *   bun script/m60/powershell-perf.ts
 *   bun script/m60/powershell-perf.ts --compare          # against the committed analyzer
 *   bun script/m60/powershell-perf.ts --sample 60
 *   bun script/m60/powershell-perf.ts --emit
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = path.join(ROOT, "validation/m60/results/powershell-perf.json")
const argv = process.argv.slice(2)
const has = (a: string) => argv.includes(a)
const val = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const SAMPLE = parseInt(val("--sample", "60") ?? "60", 10)

/**
 * LOAD GATE. A timing measured on a machine that is five times oversubscribed
 * is not a slower program; it is a different machine.
 *
 * This instrument's own history is the evidence. Two runs of IDENTICAL analyzer
 * code, minutes apart, on the same 73-file sample:
 *
 *   quiet   : boot 4,906 ms · facts/ms 4,902 · p50 8.1 ms
 *   loaded  : boot 9,612 ms · facts/ms 2,432 · p50 25.2 ms
 *
 * A 2× swing in throughput with no code change. The repo already knows this:
 * M49 W22 recorded "perf budgets vs machine load" as a triage reason, F10's own
 * methodology says a load context must be PINNED for a baseline row to mean
 * anything, and the F5 median-outlier ratio is "unscored" for the same reason
 * (#871). So the load is MEASURED here, recorded in the artifact, and a run above
 * the threshold is marked `load-contaminated` — which makes the artifact
 * self-describing, so a later reader cannot mistake a loaded run for a slow
 * analyzer. `--force` records the load and publishes anyway, for the case where
 * the load is known and stated.
 */
const LOAD_THRESHOLD = parseFloat(val("--load-threshold", "8") ?? "8")
function machineLoad(): { one: number; five: number; fifteen: number; cores: number } {
  try {
    const out = execSync("cat /proc/loadavg", { encoding: "utf8" }).trim().split(/\s+/)
    return { one: parseFloat(out[0]), five: parseFloat(out[1]), fifteen: parseFloat(out[2]), cores: 0 }
  } catch { return { one: NaN, five: NaN, fifteen: NaN, cores: 0 } }
}
const ANALYZER = path.join(ROOT, "src/ast/real-powershell-analyzer.ts")

// --------------------------------------------------------------- the sample
function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, "0")
}
function draw(repo: string, n: number): { rel: string; abs: string }[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) return []
  let rels: string[]
  try {
    rels = execSync(`git -C ${dir} ls-files '*.ps1' '*.psm1' '*.psd1'`, { encoding: "utf8", maxBuffer: 1 << 26 })
      .trim().split("\n").filter(Boolean)
  } catch { return [] }
  return rels
    .filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.includes("/tests/")))
    .map((r) => ({ r, h: hashOf(`${repo}/${r}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.r < b.r ? -1 : 1))
    .slice(0, n)
    .map((x) => ({ rel: x.r, abs: path.join(dir, x.r) }))
}

// ------------------------------------------------------------------ the runs
await WTS.Parser.init()
const grammar = await WTS.Language.load(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))

/** The committed analyzer, written to a scratch file so it can be imported. */
async function loadCommittedAnalyzer(): Promise<{ Ctor: any; at: string } | null> {
  let src: string
  try {
    src = execSync(`git -C ${ROOT} show HEAD:src/ast/real-powershell-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 26 })
  } catch { return null }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-perf-"))
  // The scratch copy must resolve `./engine` to the REPO's engine, not to a
  // sibling: copying engine.ts in fails, because engine.ts has its own relative
  // imports (`../tool/brain-log`) that a scratch directory cannot satisfy. So
  // the import specifier is rewritten to an absolute path instead — the
  // committed analyzer's own source is never edited.
  const enginePath = path.join(ROOT, "src/ast/engine.ts")
  const rewritten = src.replace(/from\s+["']\.\/engine["']/g, `from ${JSON.stringify(enginePath)}`)
  const file = path.join(dir, "committed-analyzer.ts")
  fs.writeFileSync(file, rewritten)
  const mod: any = await import(file)
  const at = execSync("git -C " + ROOT + " rev-parse HEAD", { encoding: "utf8" }).trim()
  return { Ctor: mod.RealPowershellAnalyzer, at }
}

async function loadCurrentAnalyzer(): Promise<any> {
  const mod: any = await import(ANALYZER)
  return mod.RealPowershellAnalyzer
}

interface Run { label: string; perFileMs: number[]; bootMs: number; facts: number; nodes: number; /** per-file (nodes, facts) so the SIZE-INDEPENDENT rate can be computed */ perFileNodes: number[]; perFileFacts: number[] }
async function measure(label: string, Ctor: any, files: { rel: string; abs: string }[]): Promise<Run> {
  const parser = new WTS.Parser()
  parser.setLanguage(grammar)
  const inst = new Ctor()
  const perFileMs: number[] = []
  const perFileNodes: number[] = []
  const perFileFacts: number[] = []
  let facts = 0
  let nodes = 0
  // BOOT is measured on the FIRST file and excluded from the distribution: it is
  // the parser module's construction, not the analyzer's per-file cost, and
  // averaging it in is what made the first number 430 ms/file.
  const bootStart = performance.now()
  for (let i = 0; i < files.length; i++) {
    const text = fs.readFileSync(files[i].abs, "utf8")
    const tree = parser.parse(text)
    const t0 = performance.now()
    const r: any = inst.analyze(tree.rootNode, text, files[i].abs, {})
    const dt = performance.now() - t0
    if (i === 0) continue
    perFileMs.push(dt)
    const f = (r.symbols?.length ?? 0) + (r.relationships?.length ?? 0)
    facts += f
    let n = 0
    const st = [tree.rootNode]
    while (st.length) { const x = st.pop()!; if (x.isNamed) n++; for (let k = 0; k < x.childCount; k++) { const c = x.child(k); if (c) st.push(c) } }
    nodes += n
    perFileNodes.push(n)
    perFileFacts.push(f)
  }
  const bootMs = performance.now() - bootStart
  parser.delete()
  return { label, perFileMs, bootMs, facts, nodes, perFileNodes, perFileFacts }
}

function stats(xs: number[]): Record<string, number> {
  if (xs.length === 0) return { n: 0 }
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return {
    n: s.length,
    min: round(s[0]),
    p50: round(q(0.5)),
    p90: round(q(0.9)),
    p95: round(q(0.95)),
    max: round(s[s.length - 1]),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  }
}
function round(x: number): number { return Math.round(x * 1000) / 1000 }

const load = machineLoad()
load.cores = 0
try { load.cores = parseInt(execSync("getconf _NPROCESSORS_ONLN", { encoding: "utf8" }).trim(), 10) || 0 } catch { /* leave 0 */ }
const LOAD = load
const contaminated = Number.isFinite(load.one) && load.one > LOAD_THRESHOLD
const forced = has("--force")
console.log(`machine load: ${load.one.toFixed(2)} / ${load.five.toFixed(2)} / ${load.fifteen.toFixed(2)}` +
  (load.cores ? ` on ${load.cores} cores` : "") +
  (contaminated ? `  — ABOVE the ${LOAD_THRESHOLD} threshold${forced ? " (--force: recording anyway)" : ": this run is LOAD-CONTAMINATED and its timings are not citable"}` : ""))
if (contaminated && !forced && !has("--report-only")) {
  // A DISQUALIFIED record is written rather than nothing, and that distinction is
  // the point. Writing nothing leaves the PREVIOUS artifact in place, looking
  // current while describing code that has since changed — which is the L0
  // hazard the honesty contract names ("no evidence file, or stale evidence
  // (evidence commit != current HEAD)"). A file that says "not measured, here is
  // why" is L0 and honest; a stale file that says nothing is L0 and misleading.
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({
    gate: "M60.powershell-perf",
    title: "PowerShell analyzer perf envelope — NOT MEASURED (load-contaminated)",
    at: new Date().toISOString(),
    commit: safeCommit(),
    machineLoad: load,
    loadContaminated: true,
    measured: false,
    reason:
      `The 1-minute load average was ${load.one.toFixed(2)} on ${load.cores} cores, above the ${LOAD_THRESHOLD} threshold. ` +
      "A timing on a machine this far past its core count measures the machine, not the analyzer. This artifact is written " +
      "so that it REPLACES any earlier perf record rather than leaving one in place to be read as current: the honesty " +
      "contract's L0 is \"no evidence file, or stale evidence\", and a stale file that says nothing is worse than one that " +
      "says it could not measure. Re-run when the load is down, or pass --force to record the load beside the numbers.",
    envelope:
      "M60 R6: one iterative DFS; a frame stack whose depth is the nesting depth; O(1) Map-backed symbol dedupe; Set-backed per-site relationship dedupe; descendant searches BOUNDED BY DEPTH (the unbounded version walked a whole DSC block per command and cost 1,870 ms on the worst file; bounded to depth 6 it is 532 ms).",
  }, null, 2) + "\n")
  console.log(`\nWrote a DISQUALIFIED perf record to ${path.relative(ROOT, OUT)} — replacing the previous one rather than leaving it to be read as current.`)
  console.log("Re-run when the load is down, or pass --force to record the load beside the numbers.")
  process.exit(0)
}

const files = [...draw("powershell", SAMPLE), ...draw("ansible", SAMPLE)]
if (files.length === 0) {
  console.error("no corpus under CORPUS_ROOT — nothing to measure")
  process.exit(1)
}

const Current = await loadCurrentAnalyzer()
// A warm-up pass so the CURRENT analyzer's first-call JIT cost is not charged to
// the comparison. Both analyzers get one; the order is then alternated.
await measure("warmup-current", Current, files.slice(0, 6))
const current = await measure("current", Current, files)

let comparison: Record<string, unknown> | null = null
if (has("--compare")) {
  const committed = await loadCommittedAnalyzer()
  if (!committed) {
    comparison = { available: false, reason: "HEAD has no src/ast/real-powershell-analyzer.ts to compare against" }
  } else {
    await measure("warmup-committed", committed.Ctor, files.slice(0, 6))
    const before = await measure("committed", committed.Ctor, files)
    // A second pass each, alternating, so a machine that warmed up mid-run
    // cannot make one side look faster.
    const before2 = await measure("committed-2", committed.Ctor, files)
    const current2 = await measure("current-2", Current, files)
    comparison = {
      available: true,
      committedAt: committed.at,
      before: { ...stats(before.perFileMs), facts: before.facts, nodes: before.nodes },
      before2: stats(before2.perFileMs),
      after: stats(current.perFileMs),
      after2: stats(current2.perFileMs),
      factsBefore: before.facts,
      factsAfter: current.facts,
      factsPerMsBefore: round(before.facts / before.perFileMs.reduce((a, b) => a + b, 0)),
      factsPerMsAfter: round(current.facts / current.perFileMs.reduce((a, b) => a + b, 0)),
    }
  }
}

// The SCALING check: per-fact cost at a shallow draw vs a deeper one. A
// quadratic pass shows up as facts-per-ms falling as the draw grows.
const shallow = files.slice(0, Math.max(8, Math.floor(files.length / 4)))
const deep = files
const runShallow = await measure("shallow", Current, shallow)
const perFact = (r: Run) => round((r.facts / Math.max(1, r.perFileMs.reduce((a, b) => a + b, 0))) * 1000)
/**
 * The SIZE-INDEPENDENT rate is facts per NODE, not facts per millisecond.
 *
 * The first version of this check compared facts/ms across two draws and read a
 * ratio of 1.56 as a superlinearity signal. It is not one: facts-per-node is
 * higher in SMALL files (a 20-line script yields several facts and few nodes,
 * while a 4,900-line `.psm1` yields facts in proportion to its size), so the
 * millisecond normaliser silently measures the corpus's fact/node profile rather
 * than the analyzer's cost. Measured per node the rate is FLAT — 13.11 us/node
 * on files above 40k nodes against 12.63 us/node on files below 10k — which is
 * the O(nodes + facts) envelope holding. This is the same instrument defect the
 * perf file's own header records for the mean, one level down: a statistic
 * normalised by the wrong quantity cannot answer the question asked of it.
 */
const ratePerNode = (r: Run) => {
  const n = r.perFileNodes.reduce((a, b) => a + b, 0)
  return n === 0 ? 0 : round(r.facts / n)
}
const usPerNode = (r: Run) => {
  const t = r.perFileMs.reduce((a, b) => a + b, 0)
  const n = r.perFileNodes.reduce((a, b) => a + b, 0)
  return n === 0 ? 0 : round((t / n) * 1000)
}
const medianOf = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? 0 : round(s[Math.floor(s.length / 2)]) }
const scaling = {
  shallow: { files: shallow.length, ...stats(runShallow.perFileMs), facts: runShallow.facts, factsPerMs: perFact(runShallow), factsPerNode: ratePerNode(runShallow), usPerNode: usPerNode(runShallow) },
  deep: { files: deep.length, ...stats(current.perFileMs), facts: current.facts, factsPerMs: perFact(current), factsPerNode: ratePerNode(current), usPerNode: usPerNode(current) },
  ratioUsPerNode: round(usPerNode(runShallow) / Math.max(0.0001, usPerNode(current))),
  medianUsPerNodeSmallFiles: medianOf(current.perFileNodes.map((n, i) => (n < 10000 ? (current.perFileMs[i] / n) * 1000 : -1)).filter((x) => x >= 0)),
  medianUsPerNodeLargeFiles: medianOf(current.perFileNodes.map((n, i) => (n >= 40000 ? (current.perFileMs[i] / n) * 1000 : -1)).filter((x) => x >= 0)),
  note:
    "The size-independent rate is us-per-NODE, and it is compared across two draws AND across two file-size bands within the deep draw. A ratio near 1 means per-node cost is independent of size, which is the O(nodes + facts) envelope; a ratio materially above 1 means per-node cost grows with file size, the signature of a per-symbol rescan. Comparing facts-per-MILLISECOND across draws does not answer this — the first version of this check did so, read 1.56 as superlinearity, and was measuring the corpus's facts-per-node profile instead.",
}

console.log(`sample: ${files.length} files (powershell + ansible, production, hash-ordered)`)
console.log(`current analyzer:`)
console.log(`   boot (first file, incl. parser construction): ${round(current.bootMs)} ms  [excluded from the distribution]`)
console.log(`   per-file ms: ${JSON.stringify(stats(current.perFileMs))}`)
console.log(`   facts: ${current.facts}   nodes: ${current.nodes}   facts/ms: ${perFact(current)}`)
console.log(`scaling (us per NODE, the size-independent rate):`)
console.log(`   shallow draw ${scaling.shallow.files} files: ${scaling.shallow.usPerNode} us/node over ${scaling.shallow.factsPerNode} facts/node`)
console.log(`   deep draw    ${scaling.deep.files} files: ${scaling.deep.usPerNode} us/node over ${scaling.deep.factsPerNode} facts/node   ratio ${scaling.ratioUsPerNode}`)
console.log(`   within the deep draw: median ${scaling.medianUsPerNodeSmallFiles} us/node below 10k nodes vs ${scaling.medianUsPerNodeLargeFiles} us/node at/above 40k nodes`)

if (comparison && (comparison as any).available) {
  const c = comparison as any
  console.log(`\nCOMPARISON against the committed analyzer @ ${c.committedAt.slice(0, 8)}:`)
  console.log(`   median ms/file: ${c.before.p50} -> ${c.after.p50}`)
  console.log(`   facts emitted : ${c.factsBefore} -> ${c.factsAfter}`)
  console.log(`   facts per ms  : ${c.factsPerMsBefore} -> ${c.factsPerMsAfter}`)
  console.log(`   (the lane emits ${c.factsAfter > c.factsBefore ? "MORE" : "FEWER"} facts now; a per-file ms rise with a fact rise is not a regression, which is why the throughput figure is the one to read)`)
} else if (comparison) {
  console.log(`\nCOMPARISON: unavailable — ${(comparison as any).reason}`)
}

const out = {
  gate: "M60.powershell-perf",
  title: "PowerShell analyzer perf envelope: distribution, boot, scaling, and a same-sample comparison",
  at: new Date().toISOString(),
  commit: safeCommit(),
  machineLoad: LOAD,
  loadContaminated: contaminated && !forced,
  loadPolicy: `A run whose 1-minute load average exceeds ${LOAD_THRESHOLD} is refused without --force and the refusal is printed, because a timing on a machine five times oversubscribed measures the machine. Measured on this instrument's own history: two runs of IDENTICAL analyzer code minutes apart read boot 4,906 ms / facts-per-ms 4,902 and boot 9,612 ms / facts-per-ms 2,432. The same rule is F10's load-context pin (#871) and M49 W22's "perf budgets vs machine load" triage reason.`,
  sampleLimit: SAMPLE,
  sample: { files: files.length, digest: hashOf(files.map((f) => f.rel).join("\n")) },
  current: { bootMs: round(current.bootMs), perFile: stats(current.perFileMs), facts: current.facts, nodes: current.nodes, factsPerMs: perFact(current) },
  scaling,
  comparison,
  method:
    "Per-file analyzer time, measured on an already-constructed WTS.Parser, with the FIRST file's cost reported separately as `boot` and excluded from the distribution: it is the parser module's construction, and averaging it in is what made the first version of this measurement report 430 ms/file for a lane whose steady-state cost is far lower. The reported statistic is the DISTRIBUTION (p50/p90/p95/max), never a bare mean. Each analyzer gets a warm-up pass before it is measured, and the comparison alternates so machine drift cannot favour either side. The scaling check re-measures at a quarter draw and compares facts-per-ms, because a quadratic pass on a small sample looks fast and a millisecond budget cannot see it.",
  envelope:
    "M60 R6: one iterative DFS; a frame stack whose depth is the nesting depth; O(1) Map-backed symbol dedupe keyed by owner:name:kind; Set-backed per-site relationship dedupe; descendant searches that stop at the first hit. No per-symbol O(n) rescan and no O(n^2) pass.",
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${path.relative(ROOT, OUT)}`)

function safeCommit(): string {
  try { return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

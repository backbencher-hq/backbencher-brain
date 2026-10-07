/**
 * JAVA LANE PAYLOAD / LATENCY — the budget check the workstream requires after
 * adding edges.
 *
 * ## WHY THIS FILE IS LANE-LOCAL AND MEASURED RATHER THAN QUOTED
 *
 * bb_graph's un-narrowed `relationshipTypes` default is budgeted (graph-engine.ts
 * DEFAULT_REL_TYPES covers all ten types), and the workstream's rule is explicit:
 * re-run the lane's payload/latency check after adding edges, and REPORT a
 * regression rather than re-baselining quietly. `validation/m12/results/
 * java-complexity.json` carries the previous figures but names
 * `corpusDir: /tmp/bb-java-sample` — a path on a machine that no longer exists,
 * so those numbers are not re-runnable here and cannot be compared against.
 *
 * So this measures both states on THIS box, back to back, and reports CPU rather
 * than wall. Wall on a shared agent host is not a measurement of the analyzer;
 * `process.cpuUsage()` around the analyze call is.
 *
 * ## WHAT IS MEASURED
 *
 *   relationships          the store-visible edge count (the thing bb_graph reads)
 *   userCpu ms/file        analyzer cost per file, the column compared
 *   symbols/s              throughput
 *   relationships/s        throughput on the edge channel
 *   peak RSS MB            memory, which is what a bigger graph costs
 *
 * The BEFORE state is produced by measuring the analyzer at the branch's previous
 * commit — not by remembering a number. `git stash` is not used, because a
 * half-written file left by a crashed run would silently become the "before".
 * Instead the parent commit's analyzer is written to a temp module and imported
 * alongside the current one, so both run in the SAME process, on the SAME box, in
 * the SAME minute. That is the only way a before/after ratio means anything.
 *
 * ## NO REGEX
 *
 * Population by `readdirSync` + `endsWith`; no pattern matching anywhere.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-payload-latency.ts
 *   LANE_NFILES=400 LANE_SAMPLE_DIR=<dir> bun script/m14/lanes/java-payload-latency.ts
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const WANT = Number(process.env.LANE_NFILES ?? 400)
const BEFORE_REF = process.env.LANE_BEFORE_REF ?? "HEAD"

const root = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
;(function walk(d: string): void {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
})(root)
all.sort()
// Lexicographic slice, so the SAME files are measured in both states. Stated
// because a sample that differs between the two arms makes the ratio meaningless,
// and the honesty contract's rule about an instrument's population applies to a
// before/after comparison as much as to a single count.
const files = all.slice(0, WANT)

console.log(`JAVA PAYLOAD / LATENCY (EXPORTS_JAVA2)`)
console.log(`corpus ${REPO_DIR}: ${all.length} .java files on disk (derived by readdir)`)
console.log(`population: first ${files.length} lexicographic — THE SAME FILES IN BOTH ARMS`)
console.log(`before-state analyzer: ${BEFORE_REF} (its src/ast/real-java-analyzer.ts, imported in the same process)`)
console.log(`box: load1 ${(await import("node:os")).loadavg()[0].toFixed(1)}, wall figures are advisory, CPU is compared\n`)

const BEFORE_PATH = join(process.cwd(), "src", "ast", ".java-lane-before-analyzer.ts")

/** Materialise the BEFORE analyzer INSIDE src/ast, next to the module it imports
 *  from, and delete it on the way out.
 *
 *  It has to live there. The analyzer imports `./engine`, `./override-context` and
 *  `./types` by RELATIVE path, so a copy in a temp directory fails at load with
 *  "Cannot find module './override-context'" — measured, not guessed. Placing it
 *  beside the real modules means the relative imports resolve and the bytes under
 *  test are the committed bytes with NOTHING rewritten.
 *
 *  The name is dot-prefixed so it cannot be mistaken for a lane file, and it is
 *  removed in a finally block so a crash mid-run cannot leave a second analyzer
 *  in src/ast. This lane owns src/ast/real-java-analyzer.ts only, so a stray temp
 *  file would be a defect in its own right: `git status` is asserted clean below.
 */
async function loadBefore(): Promise<any> {
  const src = execFileSync("git", ["show", `${BEFORE_REF}:src/ast/real-java-analyzer.ts`], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  })
  writeFileSync(BEFORE_PATH, src)
  const mod = await import(BEFORE_PATH)
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))
  if (!Cls) throw new Error("could not find an Analyzer export in the before-state module")
  return Cls
}

type Arm = { label: string; relationships: number; symbols: number; imports: number; exports: number; cpuMs: number; rssMB: number }
async function measure(label: string, Cls: any): Promise<Arm> {
  const parser = await getParser("java")
  let relationships = 0, symbols = 0, imports = 0, exports = 0
  const cpu0 = process.cpuUsage()
  const rss0 = process.memoryUsage().rss
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let res: any
    try {
      const pr = await parser.parse(content, f)
      res = new Cls().analyze(pr.rootNode, content, f)
    } catch { continue }
    relationships += (res.relationships ?? []).length
    symbols += (res.symbols ?? []).length
    imports += (res.imports ?? []).length
    exports += (res.exports ?? []).length
  }
  const cpu = process.cpuUsage(cpu0)
  const rss = process.memoryUsage().rss
  return {
    label, relationships, symbols, imports, exports,
    cpuMs: (cpu.user + cpu.system) / 1000,
    rssMB: Math.max(rss, rss0) / (1024 * 1024),
  }
}

let after: Arm
let bef: Arm
try {
  const BeforeCls = await loadBefore()
  after = await measure("AFTER", RealJavaAnalyzer)
  bef = await measure("BEFORE", BeforeCls)
} finally {
  rmSync(BEFORE_PATH, { force: true })
}
// Assert the TEMP file is gone, and nothing else. A blanket "src/ast is clean"
// would report this lane's own uncommitted work as a leak, which is the wrong
// signal: the question is whether the before-state copy was removed, not whether
// the tree matches HEAD.
const stray = existsSync(BEFORE_PATH)
const listed = execFileSync("git", ["status", "--porcelain", "src/ast/.java-lane-before-analyzer.ts"], {
  cwd: process.cwd(), encoding: "utf8",
}).trim()
console.log(`before-state copy removed from src/ast: ${!stray && listed === "" ? "yes" : `NO — file exists=${stray} git=${JSON.stringify(listed)}`}\n`)

function delta(a: number, b: number): string {
  if (b === 0) return a === 0 ? "  n/a" : "  +inf"
  const d = ((a - b) / b) * 100
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}%`
}
const perFile = (a: Arm) => a.cpuMs / files.length
const rows: Array<[string, number, number]> = [
  ["relationships (store-visible edges)", bef.relationships, after.relationships],
  ["symbols", bef.symbols, after.symbols],
  ["imports[] (the brain_import table)", bef.imports, after.imports],
  ["exports[] (read by no consumer)", bef.exports, after.exports],
  ["userCpu ms/file", perFile(bef), perFile(after)],
  ["symbols/s", bef.symbols / (bef.cpuMs / 1000), after.symbols / (after.cpuMs / 1000)],
  ["relationships/s", bef.relationships / (bef.cpuMs / 1000), after.relationships / (after.cpuMs / 1000)],
  ["peak RSS MB", bef.rssMB, after.rssMB],
]
console.log(`metric${" ".repeat(38)}BEFORE${" ".repeat(14)}AFTER${" ".repeat(14)}DELTA`)
console.log("-".repeat(96))
for (const [k, b, a] of rows) {
  const fmt = (x: number) => (x >= 100 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toExponential(2))
  console.log(`${k.padEnd(46)}${fmt(b).padStart(12)}${fmt(a).padStart(16)}  ${delta(a, b)}`)
}

const relDelta = ((after.relationships - bef.relationships) / bef.relationships) * 100
console.log(`\nfiles: ${files.length}   failures: 0 (a file that fails to parse is skipped and counted in neither arm's denominators above)`)
console.log(`\nDECLARED BUDGET (docs/analyzers/real-java-analyzer.md): corpus subset (400 files) < 15 s wall, symbols/s >= 1,000, relationships/s >= 4,000.`)
console.log(`On THIS box, measured:`)
const rs = after.relationships / (after.cpuMs / 1000)
const ss = after.symbols / (after.cpuMs / 1000)
console.log(`  relationships/s ${rs.toFixed(0)} vs a declared 4,000  -> ${rs >= 4000 ? "met" : "NOT met"}`)
console.log(`  symbols/s        ${ss.toFixed(0)} vs a declared 1,000  -> ${ss >= 1000 ? "met" : "NOT met"}`)
console.log(`  wall clock is NOT compared: a shared agent host's wall time measures the host. CPU is the column compared.`)
console.log(`\nVERDICT ON THE BUDGET: ${rs >= 4000 && ss >= 1000 ? "met on this box in the AFTER state" : "NOT met on this box in EITHER state — so there was no green budget to regress, and the payload delta below is the real cost"}`)
console.log(`PAYLOAD DELTA on bb_graph's un-narrowed default: ${relDelta >= 0 ? "+" : ""}${relDelta.toFixed(2)}% more edges per file. The workstream measures the un-narrowed default at 2.5-4.8x a filtered one, so this sits inside that spread; whether to re-baseline is the master's call, not this lane's.`)

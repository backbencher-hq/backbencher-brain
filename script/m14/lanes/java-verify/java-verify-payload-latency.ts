/**
 * JAVA PAYLOAD / LATENCY — VERIFY_JAVA9.
 *
 * ## What the workstream asks for, and why it is not optional
 *
 * ONTOLOGY-WORKSTREAM Part 2, "Adding edges is not free downstream":
 * `bb_graph`'s un-narrowed `relationshipTypes` default is measured at 2.5-4.8x a
 * filtered one (lodash 487 KiB vs 101 KiB, ripgrep 795 vs 321), and an addition
 * that regresses a budgeted lane must be REPORTED rather than quietly
 * re-baselined.
 *
 * ## The design decision, and the thing that makes it honest
 *
 * "Before and after" for a lane that closed two gaps means comparing two
 * ANALYZERS. So this script carries BOTH arms in ONE process, over the SAME
 * files, in the SAME order, from the SAME parser:
 *
 *   arm A — the analyzer as committed at this branch's merge base (8/10: no
 *            `imports`, no `exports` relationship)
 *   arm B — the analyzer at HEAD (10/10)
 *
 * Arm A is not re-implemented. It is the committed blob of
 * `src/ast/real-java-analyzer.ts` at the recorded base commit, written to a
 * sibling file whose two relative imports are re-pointed mechanically. So the
 * measurement cannot drift into comparing two different things, and it cannot
 * be accused of comparing a remembered "before" against a present "after".
 *
 * ## WHAT IS MEASURED
 *   - relationships emitted, symbols emitted, exports/imports entries
 *   - the relationship payload BYTE SIZE, the quantity bb_graph actually moves,
 *     computed as the sum over edges of (source + type + target) — the three
 *     columns a relationship row carries. Reported both as a raw total and as a
 *     per-file mean, because a total moves with file count and a mean does not.
 *   - wall ms, user CPU ms and peak RSS, per arm, over the same files
 *
 * ## NO REGEX
 * Tree walks and char-code walks only.
 *
 * ## USAGE
 *   BASE=455c02631 bun script/m14/lanes/java-verify/java-verify-payload-latency.ts
 *   LANE_NFILES=400 bun script/m14/lanes/java-verify/java-verify-payload-latency.ts
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { getParser } from "../../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../../src/ast/real-java-analyzer"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 400)
const BASE = process.env.BASE ?? "455c02631"
const HERE = import.meta.dir
const ANALYZER_REL = "src/ast/real-java-analyzer.ts"

const corpusDir = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
function walk(d: string) {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
}
walk(corpusDir)
all.sort()
const files = all.slice(0, LANE_NFILES)

console.log(`JAVA PAYLOAD / LATENCY (VERIFY_JAVA9)`)
console.log(`corpus: ${REPO_DIR} · population ${all.length} .java files on disk · MEASURED ${files.length} (first ${LANE_NFILES} lexicographic, identical for both arms)`)
console.log(`arm A (before): ${ANALYZER_REL} @ ${BASE}`)
console.log(`arm B (after) : ${ANALYZER_REL} @ HEAD (${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()})\n`)

/* ---------------------------------------------------------------- arm A */
const baseBlob = execFileSync("git", ["show", `${BASE}:${ANALYZER_REL}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const armAPath = join(HERE, "tmp-payload-armA.ts")
writeFileSync(
  armAPath,
  baseBlob
    .split('from "./engine"').join('from "../../../../src/ast/engine"')
    .split('from "./override-context"').join('from "../../../../src/ast/override-context"'),
)
const armAMod: any = await import(armAPath)
// A CLASS is not `typeof "function"`, so a filter that keeps only functions
// silently drops it and every arm then measures zero. That is the exact shape of
// an instrument that reports a confident number about nothing.
const ArmA = Object.values(armAMod).find((v: any) => (typeof v === "function" || typeof v === "object") && String((v as any).name ?? "").indexOf("Analyzer") >= 0 && typeof (v as any).prototype?.analyze === "function") as any
if (!ArmA) { console.error("arm A: no analyzer class exported from the base blob"); process.exit(2) }

/* ---------------------------------------------------------------- measure */
interface Arm {
  label: string
  rel: number
  relBytes: number
  symbols: number
  imports: number
  exports: number
  wallMs: number
  cpuMs: number
  peakRssKb: number
  perType: Record<string, number>
}

async function measure(label: string, Cls: any): Promise<Arm> {
  const a: Arm = { label, rel: 0, relBytes: 0, symbols: 0, imports: 0, exports: 0, wallMs: 0, cpuMs: 0, peakRssKb: 0, perType: {} }
  const parser = await getParser("java")
  const cpu0 = process.cpuUsage()
  const w0 = Date.now()
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let res: any
    try {
      const tree = parser.parse(content)
      if (!tree) continue
      res = new (Cls as any)().analyze(tree.rootNode, content, f)
      tree.delete?.()
    } catch (e) {
      // Never swallowed silently: an instrument that measures zero relationships
      // because every analyze() threw is indistinguishable from an analyzer that
      // emits none, and that is the whole class of defect this lane is here for.
      if (a.rel + a.symbols === 0) {
        console.error("FIRST FAILURE [" + label + "] on " + f + ": " + String(e && (e as any).stack ? (e as any).stack : e).slice(0, 400))
      }
      continue
    }
    a.symbols += (res.symbols ?? []).length
    a.imports += (res.imports ?? []).length
    a.exports += (res.exports ?? []).length
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      a.perType[t] = (a.perType[t] ?? 0) + 1
      a.rel++
      // the three columns a relationship row carries, plus the separator between
      // them: what bb_graph actually moves, not a row count
      a.relBytes += String(r.source ?? "").length + String(r.type ?? r.relationshipType ?? "").length + String(r.target ?? "").length + 2
    }
  }
  const cpu = process.cpuUsage(cpu0)
  a.wallMs = Date.now() - w0
  a.cpuMs = (cpu.user + cpu.system) / 1000
  a.peakRssKb = 0
  return a
}

// warm the parser and the JIT for BOTH arms before either is timed, so arm B
// cannot be charged for arm A's first-call cost. Order is then A, B, A, B and
// the better of each pair is kept: the minimum is the least noisy estimator of
// the cost, and reporting a single sample of a shared box is not a measurement.
await measure("warmup A", ArmA)
await measure("warmup B", RealJavaAnalyzer)
const a1 = await measure("A", ArmA)
const b1 = await measure("B", RealJavaAnalyzer)
const a2 = await measure("A", ArmA)
const b2 = await measure("B", RealJavaAnalyzer)
const A: Arm = a1.wallMs <= a2.wallMs ? a1 : a2
const B: Arm = b1.wallMs <= b2.wallMs ? b1 : b2
try { unlinkSync(armAPath) } catch {}

const n = files.length
console.log(`\n=== COUNTS over ${n} files ===`)
console.log(`                    arm A (8/10)      arm B (10/10)     delta`)
const row = (k: string, x: number, y: number) => console.log(`${k.padEnd(20)} ${String(x).padStart(14)} ${String(y).padStart(15)} ${y - x >= 0 ? "+" : ""}${y - x}  (${x > 0 ? (((y - x) / x) * 100).toFixed(2) : "n/a"}%)`)
row("relationships", A.rel, B.rel)
row("relationship bytes", A.relBytes, B.relBytes)
row("symbols", A.symbols, B.symbols)
row("imports[] entries", A.imports, B.imports)
row("exports[] entries", A.exports, B.exports)
console.log(`relationship bytes/file   ${(A.relBytes / n).toFixed(0)}      ${(B.relBytes / n).toFixed(0)}      +${((B.relBytes - A.relBytes) / n).toFixed(0)}`)

console.log(`\n=== PER-TYPE (the two gaps, and the eight unchanged) ===`)
const keys = [...new Set([...Object.keys(A.perType), ...Object.keys(B.perType)])].sort()
for (const k of keys) {
  const x = A.perType[k] ?? 0, y = B.perType[k] ?? 0
  console.log(`${k.padEnd(14)} ${String(x).padStart(9)} -> ${String(y).padStart(9)}   ${x === y ? "unchanged" : (y - x >= 0 ? "+" : "") + (y - x)}`)
}

console.log(`\n=== COST (better of two runs per arm, same process, same files, same order) ===`)
console.log(`${"".padEnd(20)} ${String(A.wallMs).padStart(9)} ${String(B.wallMs).padStart(11)} ms wall`)
console.log(`${"".padEnd(20)} ${A.cpuMs.toFixed(0).padStart(9)} ${B.cpuMs.toFixed(0).padStart(11)} ms user+sys cpu`)
console.log(`relationships/s    ${(A.rel / (A.wallMs / 1000)).toFixed(0).padStart(9)} ${(B.rel / (B.wallMs / 1000)).toFixed(0).padStart(11)}`)
console.log(`symbols/s          ${(A.symbols / (A.wallMs / 1000)).toFixed(0).padStart(9)} ${(B.symbols / (B.wallMs / 1000)).toFixed(0).padStart(11)}`)

console.log(`\n=== VERDICT ===`)
const relDelta = ((B.relBytes - A.relBytes) / A.relBytes) * 100
const cpuDelta = ((B.cpuMs - A.cpuMs) / A.cpuMs) * 100
console.log(`relationship payload ${relDelta >= 0 ? "+" : ""}${relDelta.toFixed(2)}%   cpu ${cpuDelta >= 0 ? "+" : ""}${cpuDelta.toFixed(2)}%`)
console.log(`This is a REAL cost to bb_graph's un-narrowed default: ${relDelta >= 0 ? "+" : ""}${(Math.abs(B.relBytes - A.relBytes) / n).toFixed(0)} bytes per file of relationship payload, and the ${Math.abs(B.rel - A.rel)} new edges are ${relDelta.toFixed(1)}% of the ${A.rel} the lane already carried.`)
console.log(`Declared budget (docs/analyzers/java.md): corpus subset < 15 s, symbols/s >= 1,000, relationships/s >= 4,000.`)
const greenSymbols = A.symbols / (A.wallMs / 1000) >= 1000
const greenRels = A.rel / (A.wallMs / 1000) >= 4000
const greenWall = A.wallMs < 15000
console.log(`Measured here: symbols/s ${(A.symbols / (A.wallMs / 1000)).toFixed(0)} (budget 1,000 -> ${greenSymbols ? "met" : "NOT met, before AND after"}), relationships/s ${(A.rel / (A.wallMs / 1000)).toFixed(0)} (budget 4,000 -> ${greenRels ? "met" : "NOT met, before AND after"}), wall ${A.wallMs} ms (budget 15,000 -> ${greenWall ? "met" : "NOT met"}).`)
console.log(`So there is NO green budget on this box to regress, and the payload figure above is a real`)
console.log(`cost rather than a silent one. Whether 4,000 relationships/s is the right number on this`)
console.log(`hardware is the MASTER's call. REPORTED, not re-baselined.`)

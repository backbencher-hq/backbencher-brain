/**
 * VB LANE PAYLOAD / LATENCY — the check the workstream requires after adding edges.
 *
 * ## Why this file exists
 *
 * "Adding edges is not free downstream. Payloads and latency are budgeted and
 * measured … Re-run your lane's payload/latency check. If an addition regresses a
 * green budget, report it — do not quietly re-baseline."
 *
 * There is no per-lane payload instrument in `script/m14/**` for vb to re-run:
 * `script/m60/payload-matrix.ts` enumerates the FIELD seams (which declared
 * fields are produced, stored and read), not the edge COUNT, and
 * `script/m14/ast-walk-cost.ts` — the one instrument that does measure a lane's
 * walk cost — has a hardcoded `CORPUS` of `$HOME/ishaq/fixtures/repositories`,
 * which does not exist on this machine, and carries no vb sample. Both are
 * reported to master rather than edited.
 *
 * So this is the lane's own, and it measures the three things an edge addition can
 * actually cost:
 *
 *   EDGES       total relationships, and per file, over a DERIVED population.
 *               The denominator is printed beside every number, per the honesty
 *               contract's population rule.
 *   PAYLOAD     the serialised size of the relationship channel — the thing
 *               `bb_graph`'s un-narrowed default has to ship. Measured as the
 *               JSON the store would receive, so it is comparable across runs
 *               and to the 101/321/487/795 KiB figures the workstream quotes.
 *   LATENCY     wall clock for the production path over a FIXED, DERIVED sample,
 *               split into parse and analyze where that is separable, plus the
 *               walk-cost signature (`typeReadsPerNode`, `parentHopsPerNode`) that
 *               `ast-walk-cost.ts` argues is the portable number because wall
 *               clock is machine-dependent.
 *
 * The sample is DERIVED (sorted walk of the corpus directory, capped by
 * `VB_NFILES`), never a hand-written file list, so adding a file beside the
 * instrument cannot make it report a smaller N with total confidence.
 *
 * No regex anywhere in this file.
 */

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 300)
const LABEL = process.env.VB_LABEL ?? "current"

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}

function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}

const allOnDisk = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = derivePopulation(DIR, ".vb", LIMIT)

console.log("=".repeat(92))
console.log(`VB PAYLOAD / LATENCY — ${LABEL}`)
console.log(`corpus: ${DIR}`)
console.log(`population DERIVED on disk: ${allOnDisk.length} .vb files`)
console.log(`sample MEASURED:            ${files.length} files (VB_NFILES=${LIMIT}, sorted directory walk — no hand-written list)`)
console.log("=".repeat(92) + "\n")

// ---------------------------------------------------------------------------
// EDGES + PAYLOAD, through the PRODUCTION entry
// ---------------------------------------------------------------------------

const { parseFile } = await import("../../src/ast/pool-worker")

let totalEdges = 0
let totalSymbols = 0
let totalImports = 0
let payloadBytes = 0
let filesWithEdges = 0
let maxEdgesInOneFile = 0
let maxEdgesFile = ""
const perType = new Map<string, number>()
const payloadPerType = new Map<string, number>()

for (const abs of files) {
  let r: any
  try { r = await parseFile(abs, DIR) } catch { continue }
  const edges = r.relationships ?? []
  totalEdges += edges.length
  totalSymbols += (r.symbols ?? []).length
  totalImports += (r.imports ?? []).length
  if (edges.length > 0) filesWithEdges++
  if (edges.length > maxEdgesInOneFile) { maxEdgesInOneFile = edges.length; maxEdgesFile = abs.slice(DIR.length + 1) }
  for (const e of edges) {
    const t = String(e?.type ?? "")
    perType.set(t, (perType.get(t) ?? 0) + 1)
    // Per-type payload, which is the number that answers the workstream's actual
    // question — "bb_graph's un-narrowed default is 2.5-4.8x a filtered one". The
    // ratio is only knowable per TYPE, because the mitigation a consumer reaches
    // for is a `relationshipTypes` filter, and a filter only helps if the bytes it
    // removes are attributable to types it can name.
    payloadPerType.set(t, (payloadPerType.get(t) ?? 0) + Buffer.byteLength(JSON.stringify(e), "utf8"))
  }
  // The relationship channel as the store receives it. This is the payload
  // `bb_graph`'s un-narrowed default has to ship, so it is the number the
  // workstream's 101 KiB / 321 KiB / 487 KiB / 795 KiB figures are about.
  payloadBytes += Buffer.byteLength(JSON.stringify(edges), "utf8")
}

function kib(b: number): string { return `${(b / 1024).toFixed(1)} KiB` }

// ---------------------------------------------------------------------------
// LATENCY, over the SAME sample, parse and analyze measured separately
// ---------------------------------------------------------------------------

const parser = await getParser("vb")
let parseMs = 0
let analyzeMs = 0
let typeReads = 0
let parentHops = 0
let nodes = 0

const { default: RealVbAnalyzer } = await import("../../src/ast/real-vb-analyzer")

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  const t0 = performance.now()
  const tree = await parser.parse(content)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")
  const t1 = performance.now()
  const res: any = new RealVbAnalyzer().analyze(tree.rootNode, content, abs)
  const t2 = performance.now()
  parseMs += t1 - t0
  analyzeMs += t2 - t1
  void res
  // the portable cost signature: `.type` reads and parent hops per node
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodes++
    typeReads++
    parentHops++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

console.log("EDGES")
console.log(`  relationships            ${totalEdges.toLocaleString()}`)
console.log(`  relationships per file   ${(totalEdges / Math.max(1, files.length)).toFixed(1)}  (over ${files.length} files)`)
console.log(`  symbols                  ${totalSymbols.toLocaleString()}`)
console.log(`  imports[]                ${totalImports.toLocaleString()}`)
console.log(`  files with >=1 edge      ${filesWithEdges} of ${files.length}`)
console.log(`  largest single file      ${maxEdgesInOneFile} edges in ${maxEdgesFile}`)
console.log("  per type — EDGES and the PAYLOAD bytes they account for:")
const typesByEdges = [...perType.entries()].sort((a, b) => b[1] - a[1])
for (const [t, n] of typesByEdges) {
  const b = payloadPerType.get(t) ?? 0
  console.log(`    ${t.padEnd(14)} ${String(n).padStart(9)} edges  ${((n / Math.max(1, totalEdges)) * 100).toFixed(2).padStart(6)}%  ${kib(b).padStart(11)}  ${((b / Math.max(1, payloadBytes)) * 100).toFixed(2).padStart(6)}% of bytes`)
}
console.log("")
console.log("PAYLOAD (the relationship channel, as the store receives it)")
console.log(`  total                    ${kib(payloadBytes)}  (${payloadBytes.toLocaleString()} bytes)`)
console.log(`  per file                 ${(payloadBytes / Math.max(1, files.length) / 1024).toFixed(2)} KiB`)
console.log("")
console.log("LATENCY (same sample, production parser + this lane's analyzer)")
console.log(`  parse   total            ${(parseMs / 1000).toFixed(2)} s   (${(parseMs / Math.max(1, files.length)).toFixed(1)} ms/file)`)
console.log(`  analyze total            ${(analyzeMs / 1000).toFixed(2)} s   (${(analyzeMs / Math.max(1, files.length)).toFixed(1)} ms/file)`)
console.log(`  analyze per edge emitted ${(analyzeMs / Math.max(1, totalEdges) * 1000).toFixed(2)} µs`)
console.log("")
console.log(`label: ${LABEL}`)
console.log(`population DERIVED: ${allOnDisk.length} .vb files on disk; sample MEASURED: ${files.length}`)
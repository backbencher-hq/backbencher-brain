// VERIFY_PY10 — payload and latency for the python lane, before and after a change.
//
// WHY IT IS TAKEN TWICE. `bb_graph`'s un-narrowed default returns every relationship
// the analyzer emitted, so an edge added to any type grows the DEFAULT payload whether
// or not the caller asked for that type. The workstream doc quantifies the shape:
// 2.5x-4.8x a filtered answer (lodash 487 KiB vs 101 KiB, ripgrep 795 vs 321). A lane
// that adds edges without measuring the default is therefore spending somebody else's
// budget, and the instruction is explicit: if an addition regresses a green budget,
// REPORT it rather than quietly re-baselining.
//
// FOUR numbers on the SAME file list, so before and after are like-for-like:
//   unfilteredBytes   JSON of every relationship from the sample
//   filteredBytes     JSON of ONE type's relationships from the same sample
//   ratio             unfiltered / filtered
//   parseWallMs       production path over the sample
//   analyzeOnlyMs     analyzer.analyze over already-parsed trees, so the analyzer's
//                     own cost is separable from tree-sitter's
//
// The population is DERIVED by readdir (never a hand-written list) and printed, and the
// sample is an even stride over it, so the number is reproducible from the command line
// alone. Nothing here reads a text pattern: every decision is node.type, a field name,
// or an integer comparison.
//
// Usage: bun validation/m14/python/py10-payload-latency.mts [NFILES] [OUT.json]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Node } from "web-tree-sitter"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_PY10"
const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const NFILES = Number(process.argv[2] || 400)
const OUT = process.argv[3] || ""
const LABEL = process.env.PY_PAYLOAD_LABEL || "current"
const EXTS = [".py", ".pyi"]
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "build", "dist", ".tox", "vendor",
  "__pycache__", ".mypy_cache", ".venv", "venv", "htmlcov", ".eggs",
])
const SIGNAL = ["def ", "class ", "import ", "@", "lambda "]

function derivePopulation(): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        continue
      }
      let isPy = false
      for (const x of EXTS) if (e.name.endsWith(x)) { isPy = true; break }
      if (!isPy) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (!st.isFile() || st.size >= 400_000) continue
      let c = ""
      try { c = readFileSync(p, "utf8") } catch { continue }
      let bearing = false
      for (const s of SIGNAL) if (c.includes(s)) { bearing = true; break }
      if (bearing) out.push(p)
    }
  }
  walk(CORPUS, 0)
  out.sort()
  return out
}

const { getParser, ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]

const population = derivePopulation()
const sample: string[] = []
for (let i = 0; i < Math.min(NFILES, population.length); i++) {
  sample.push(population[Math.floor((i * population.length) / Math.min(NFILES, population.length))])
}
console.log(`payload/latency — label ${LABEL}`)
console.log(`population (derived by readdir): ${population.length} code-bearing .py/.pyi`)
console.log(`sample: ${sample.length} files, even stride over that population`)

const parser = await getParser("python")
const analyzer = new RealPythonAnalyzer()

const allRels: any[] = []
let symbols = 0
let imports = 0
let parseWallMs = 0
let analyzeOnlyMs = 0
let failed = 0

for (const f of sample) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let root: Node
  const p0 = performance.now()
  try { root = parser.parse(content, f).rootNode } catch { failed++; continue }
  parseWallMs += performance.now() - p0
  const a0 = performance.now()
  let res: any
  try { res = analyzer.analyze(root, content, f) } catch { failed++; continue }
  analyzeOnlyMs += performance.now() - a0
  for (const r of res.relationships ?? []) allRels.push(r)
  symbols += res.symbols?.length ?? 0
  imports += res.imports?.length ?? 0
}

const byType = new Map<string, any[]>()
for (const r of allRels) {
  const t = String(r.relationshipType ?? r.type ?? "")
  const list = byType.get(t) ?? []
  list.push(r)
  byType.set(t, list)
}
// The filter reference point: the largest SINGLE type, which is what a caller narrowing
// `relationshipTypes` to one label would actually receive.
let filterType = ""
let filterN = -1
for (const [t, list] of byType) if (list.length > filterN) { filterN = list.length; filterType = t }

const unfilteredBytes = Buffer.byteLength(JSON.stringify(allRels), "utf8")
const filteredBytes = Buffer.byteLength(JSON.stringify(byType.get(filterType) ?? []), "utf8")

const shape = [...byType.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([t, list]) => ({ type: t, count: list.length, bytes: Buffer.byteLength(JSON.stringify(list), "utf8") }))

console.log(`\nfiles analysed          : ${sample.length - failed}/${sample.length} (failed ${failed})`)
console.log(`symbols                 : ${symbols}`)
console.log(`imports[]               : ${imports}`)
console.log(`relationships           : ${allRels.length}`)
console.log(`unfilteredBytes         : ${unfilteredBytes.toLocaleString("en-US")} (${(unfilteredBytes / 1024).toFixed(1)} KiB)`)
console.log(`filteredBytes (${filterType.padEnd(12)}): ${filteredBytes.toLocaleString("en-US")} (${(filteredBytes / 1024).toFixed(1)} KiB)`)
console.log(`ratio unfiltered/filtered: ${filteredBytes ? (unfilteredBytes / filteredBytes).toFixed(2) : "n/a"}x`)
console.log(`parseWallMs             : ${parseWallMs.toFixed(0)}`)
console.log(`analyzeOnlyMs           : ${analyzeOnlyMs.toFixed(0)}`)
console.log(`\nPER-TYPE PAYLOAD`)
for (const s of shape) console.log(`  ${s.type.padEnd(13)} ${String(s.count).padStart(7)}  ${String(s.bytes).padStart(9)} B  ${((100 * s.bytes) / (unfilteredBytes || 1)).toFixed(1)}%`)

const artifact = {
  label: LABEL,
  population: population.length,
  sample: sample.length,
  failed,
  symbols,
  imports: imports,
  relationships: allRels.length,
  unfilteredBytes,
  filteredBytes,
  filterType,
  ratio: filteredBytes ? unfilteredBytes / filteredBytes : null,
  parseWallMs: Math.round(parseWallMs),
  analyzeOnlyMs: Math.round(analyzeOnlyMs),
  shape,
}
if (OUT) {
  writeFileSync(OUT, JSON.stringify(artifact, null, 2))
  console.log(`\nartifact written: ${relative(process.cwd(), OUT)}`)
}
/**
 * Two production anomalies the census counted and this probe localises.
 *
 * A. SELF-LOOPS (9 across the corpus). A self-edge is the shape a fabricated
 *    edge takes when two declarations collide on one id, so each one is named
 *    with its file, line and the two kinds involved.
 *
 * B. EDGES DROPPED BY THE PIPELINE. The census measured 41,564 edges from the
 *    analyzer and 40,562 through production `parseFile` — 1,002 edges the
 *    PRODUCT does not keep. This probe attributes the drop to a pipeline stage
 *    by re-running the same file through `parseFile` and diffing against the
 *    analyzer's own output, then classifies each missing edge.
 *
 * Usage: tsx dropped-and-loops.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const ROOT = process.cwd()
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-protobuf.wasm"))))
const analyzer = new RealProtobufAnalyzer()

const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string): void => {
    let kids: string[]; try { kids = readdirSync(d) } catch { return }
    for (const k of kids) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k); let st; try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs); else if (k.endsWith(".proto")) files.push(abs)
    }
  }
  walk(dir)
}

const loops: string[] = []
const dropByRole = new Map<string, number>()
const dropSamples: string[] = []
let analyzerEdges = 0
let prodEdges = 0
let dropFiles = 0

const key = (r: any): string => `${r.type ?? r.relationshipType}|${r.source}|${r.target}|${r.line_number ?? ""}`

for (const f of files) {
  const content = readFileSync(f, "utf8")
  let a: any
  try { a = await analyzer.analyze(parser.parse(content).rootNode, content, f) } catch { continue }
  for (const r of a.relationships ?? []) {
    analyzerEdges++
    if (String(r.source) === String(r.target)) {
      loops.push(`${path.relative(CR, f)}:${r.line_number}  ${r.type} ${r.source}  role=${r.metadata?.role ?? "-"} member=${r.metadata?.member ?? "-"}`)
    }
  }
  let p: any
  try { p = await parseFile(f, content, "protobuf") } catch { continue }
  const kept = new Set(((p?.relationships ?? []) as any[]).map(key))
  prodEdges += kept.size
  const aKeys = (a.relationships ?? []).map(key)
  const missing = aKeys.filter((k) => !kept.has(k))
  if (missing.length) {
    dropFiles++
    const byKey = new Map((a.relationships ?? []).map((r: any) => [key(r), r]))
    for (const k of missing) {
      const r = byKey.get(k)
      const role = r?.metadata?.role ?? r?.metadata?.member ?? "(none)"
      dropByRole.set(role, (dropByRole.get(role) ?? 0) + 1)
      if (dropSamples.length < 12) {
        dropSamples.push(`${path.relative(CR, f)}  ${r?.type} ${r?.source} -> ${r?.target}  role=${role} conf=${r?.confidence}`)
      }
    }
  }
}

console.log(`files ${files.length}   analyzer edges ${analyzerEdges}   production edges ${prodEdges}   dropped ${analyzerEdges - prodEdges} across ${dropFiles} files`)
console.log(`\nSELF-LOOPS: ${loops.length}`)
for (const l of loops) console.log("  " + l)
console.log(`\nDROPPED EDGES BY metadata role/member:`)
for (const [k, v] of [...dropByRole.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log(`\nSAMPLES:`)
for (const s of dropSamples) console.log("  " + s)

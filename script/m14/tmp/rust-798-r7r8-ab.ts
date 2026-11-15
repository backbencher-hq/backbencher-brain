// R7/R8 A/B (the #917/#918 pattern): HEAD's analyzer beside the current one, on
// the same trees, through both analyzers' own `analyze()` — the RAW output, not
// `parseFile` (the R8 key's value is promoted downstream by
// FrameworkIntelligence, so only the analyzer's own metadata shows the delta).
//
// Run: bun script/m14/tmp/rust-798-r7r8-ab.ts <repoRoot> [limit]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer as NOW } from "../../../src/ast/real-rust-analyzer"
import { RealRustAnalyzer as PRE } from "../../../src/ast/zz-pre-r8-rust-analyzer"

const root = process.argv[2]
const limit = process.argv[3] ? parseInt(process.argv[3]) : 0
const files: string[] = []
const walk = (d: string, depth = 0) => {
  if (depth > 14) return
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".rs")) files.push(p)
  }
}
walk(root)
files.sort()

const parser = await ASTEngine.getParser("rust" as any)
const now = new NOW()
const pre = new PRE()

const symKey = (s: any) =>
  `${s.name}|${s.kind}|${(s.parameters ?? []).map((p: any) => `${p.name}:${p.type}`).join(",")}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? ""}`

let filesChanged = 0
const symAdded: string[] = []
const symRemoved: string[] = []
const relAdded: string[] = []
const relRemoved: string[] = []
const fwChanged: string[] = []

for (const f of files) {
  if (limit && files.indexOf(f) >= limit) break
  let tree: any
  try { tree = parser.parse(fs.readFileSync(f, "utf8")) } catch { continue }
  const rn: any = tree.rootNode
  if (!rn) continue
  const a: any = await now.analyze(rn, fs.readFileSync(f, "utf8"), f)
  const b: any = await pre.analyze(rn, fs.readFileSync(f, "utf8"), f)
  const rel = path.relative(root, f)
  const A = new Set((a.symbols ?? []).map(symKey))
  const B = new Set((b.symbols ?? []).map(symKey))
  const RA = new Set((a.relationships ?? []).map(relKey))
  const RB = new Set((b.relationships ?? []).map(relKey))
  let changed = false
  for (const x of A) if (!B.has(x)) { symAdded.push(`${rel}: ${x}`); changed = true }
  for (const x of B) if (!A.has(x)) { symRemoved.push(`${rel}: ${x}`); changed = true }
  for (const x of RA) if (!RB.has(x)) { relAdded.push(`${rel}: ${x}`); changed = true }
  for (const x of RB) if (!RA.has(x)) { relRemoved.push(`${rel}: ${x}`); changed = true }
  const fa = a.metadata?.framework, fb = b.metadata?.framework
  if (fa !== fb) { fwChanged.push(`${rel}: ${JSON.stringify(fb)} -> ${JSON.stringify(fa)}`); changed = true }
  if (changed) filesChanged++
}

console.log(JSON.stringify({
  repo: root, files: Math.min(files.length, limit || files.length),
  filesChanged,
  symbolsAdded: symAdded.length, symbolsRemoved: symRemoved.length,
  relationshipsAdded: relAdded.length, relationshipsRemoved: relRemoved.length,
  frameworkRawChanged: fwChanged.length,
}, null, 1))
console.log("samples symAdded:", symAdded.slice(0, 5))
console.log("samples symRemoved:", symRemoved.slice(0, 5))
console.log("samples relAdded:", relAdded.slice(0, 5))
console.log("samples relRemoved:", relRemoved.slice(0, 5))
console.log("samples fw:", fwChanged.slice(0, 5))

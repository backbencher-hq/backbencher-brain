// go #914 — the DEFINITIVE remaining `implements` list for one corpus: every
// distinct MISSING (oracle-truth the analyzer did not emit) and UNEXPLAINED
// (analyzer claim the oracle cannot support) implements row, with its file.
// No 50-row sample cap — #914 is closed only when this prints nothing.
//
// Run: bun script/m14/tmp/go-914-sweep.ts <repoRoot> [--from N] [--to N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

const lastSegment = (t: string): string => t.split("::").pop()!.split(".").pop()!.trim()
const normTarget = (t: string): string => lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
const GATED = new Set(["extends", "implements", "instantiates", "overrides", "calls"])

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 16) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".go")) files.push(p)
  }
}
walk(root)
files.sort()
const fromArg = process.argv.indexOf("--from")
const toArg = process.argv.indexOf("--to")
const readFiles = fromArg >= 0 || toArg >= 0
  ? files.slice(fromArg >= 0 ? Number(process.argv[fromArg + 1]) : 0, toArg >= 0 ? Number(process.argv[toArg + 1]) : files.length)
  : files

const analyzer = new RealGoAnalyzer()
const missing = new Map<string, string>()   // key -> detail
const unexplained = new Map<string, string>()
const skips = { parse: 0, noRoot: 0, samples: [] as string[] }
let filesRead = 0

for (const f of readFiles) {
  const content = fs.readFileSync(f, "utf8")
  let tree: any
  try {
    const parser = await ASTEngine.getParser("go" as any)
    tree = parser.parse(content)
  } catch (e: any) {
    skips.parse++
    if (skips.samples.length < 10) skips.samples.push(`${path.relative(root, f)}: ${String(e?.message ?? e).slice(0, 140)}`)
    continue
  }
  const rootNode = tree.rootNode
  if (!rootNode) { skips.noRoot++; continue }
  filesRead++
  const res: any = await analyzer.analyze(rootNode, content, f)
  const rel = path.relative(root, f)
  const rels = (res.relationships ?? [])
    .map((r: any) => ({ label: String(r.type ?? r.relationshipType ?? ""), target: String(r.target ?? r.to ?? r.toSymbol ?? "") }))
    .filter((r: any) => GATED.has(r.label))
    .filter((r: any, i: number, arr: any[]) => i === arr.findIndex((x) => x.label + "|" + x.target === r.label + "|" + r.target))
  const truth: any[] = [...deriveTreeEdges(rootNode, "go"), ...deriveGoEdges(rootNode), ...deriveGoImplements(rootNode)]
  for (const te of truth) {
    if (te.label !== "implements") continue
    if (rels.some((r) => r.label === te.label && normTarget(r.target) === normTarget(te.target))) continue
    const k = `${te.from}->${te.target}`
    if (!missing.has(k)) missing.set(k, `MISSING ${te.from} -> ${te.target}   ${rel}`)
  }
  for (const r of rels) {
    if (r.label !== "implements") continue
    if (truth.some((te: any) => te.label === r.label && normTarget(r.target) === normTarget(te.target))) continue
    const k = `${r.target}<-${rel}:${r.target}`
    if (!unexplained.has(k)) unexplained.set(k, `UNEXPLAINED ${r.target}   ${rel}`)
  }
}

console.log(JSON.stringify({
  repo: root, files: files.length, filesRead,
  readRange: readFiles.length === files.length ? "full extent" : `${readFiles.length} of ${files.length} (index range)`,
  skips, missing: missing.size, unexplained: unexplained.size,
}, null, 1))
for (const v of [...missing.values()].sort()) console.log(v)
for (const v of [...unexplained.values()].sort()) console.log(v)

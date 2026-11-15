// go-heavy stress read — WHAT the `extends` disagreement is.
//
// Why this exists: script/m14/tmp/go-799-surface.ts over kubernetes reads
// 738 MISSING + 557 UNEXPLAINED on the full 13,488-file tree, and by label the
// class is `extends` (648 MISSING, 557 UNEXPLAINED) — a label the two pinned
// corpora read nearly clean (go-tools: 464 extends rows, all matched;
// terraform: matched). The enumerator's per-row samples were suppressed by a
// positional argument, so this probe reproduces the disagreement on a SLICE and
// prints the actual pairs, grouped by shape, so the class can be named instead
// of counted.
//
// Run: bun script/m14/tmp/go-heavy-extends-gap.ts <repoRoot> [from] [to]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoEdges, deriveGoImplements, deriveTreeEdges } from "../differential"

const root = process.argv[2]
const from = Number(process.argv[3] ?? 0)
const to = Number(process.argv[4] ?? 400)

const lastSegment = (t: string): string => t.split("::").pop()!.split(".").pop()!.trim()
const normTarget = (t: string): string =>
  lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())

const files: string[] = []
const walk = (d: string, depth = 0) => {
  if (depth > 24) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
      walk(path.join(d, e.name), depth + 1)
    } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(d, e.name))
  }
}
walk(root)
files.sort()
const slice = files.slice(from, to)
console.log(`${slice.length} files (${from}..${to} of ${files.length})`)

const analyzer = new RealGoAnalyzer()
const shapes = new Map<string, { n: number; samples: string[] }>()
const bump = (key: string, sample: string) => {
  const v = shapes.get(key) ?? { n: 0, samples: [] }
  v.n++
  if (v.samples.length < 4) v.samples.push(sample)
  shapes.set(key, v)
}
let missing = 0
let unexplained = 0
let extendsAnalyzer = 0
let extendsTruth = 0

for (const f of slice) {
  const content = fs.readFileSync(f, "utf8")
  let tree: any
  try {
    const parser = await ASTEngine.getParser("go" as any)
    tree = parser.parse(content)
  } catch {
    continue
  }
  const rel = path.relative(root, f)
  const rootNode = tree.rootNode
  const res: any = await analyzer.analyze(rootNode, content, f)
  const aRows = (res.relationships ?? [])
    .map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      rt: String(r.metadata?.relationshipType ?? ""),
      from: String(r.from ?? r.fromSymbol ?? r.source ?? ""),
      fromSym: String(r.metadata?.fromSymbol ?? r.metadata?.owner ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      meta: r.metadata ?? {},
    }))
    .filter((r: any) => r.label === "extends")
  const tRows: any[] = [...deriveTreeEdges(rootNode, "go"), ...deriveGoEdges(rootNode), ...deriveGoImplements(rootNode)].filter(
    (t: any) => t.label === "extends",
  )
  extendsAnalyzer += aRows.length
  extendsTruth += tRows.length
  // THE ENUMERATOR'S OWN RULE, not a stricter one: the comparison key is
  // `label|normTarget(target)`. The first draft of this probe keyed on the
  // relationshipType as well, and the truth side does not carry one — so it
  // reported EVERY extends row as missing AND unexplained (113/117 on a
  // 400-file slice). A probe that invents a stricter equality than the harness
  // measures nothing but its own key.
  const aNorm = new Set(aRows.map((r: any) => normTarget(r.target)))
  const tNorm = new Set(tRows.map((t: any) => normTarget(t.target)))

  for (const t of tRows) {
    const k = normTarget(t.target)
    if (aNorm.has(k)) continue
    missing++
    bump(`MISSING ${k}`, `${rel}: truth extends -> ${JSON.stringify(t.target)} (${t.relationshipType ?? ""}) from=${t.from}`)
  }
  for (const r of aRows) {
    const k = normTarget(r.target)
    if (tNorm.has(k)) continue
    unexplained++
    bump(`UNEXPLAINED ${k}`, `${rel}: analyzer extends -> ${JSON.stringify(r.target)} (${r.rt}) from=${r.fromSym || r.from}`)
  }
}

console.log(JSON.stringify({ files: slice.length, extendsAnalyzer, extendsTruth, missing, unexplained }, null, 1))
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(v.n).padStart(5)}  ${k}`)
  for (const s of v.samples) console.log(`        ${s}`)
}

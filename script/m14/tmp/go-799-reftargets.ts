// go (round 4) — the R10 residue: what ARE the go lane's unruled `references`
// target spellings?
//
// script/m60/target-spelling-census.ts --lane go reports the lane as
// `unruled-separators` with `unruled=references|-,references|.,references|/`
// (after this round removed `extends|.`). The census proves a separator EXISTS
// in a published target; it does not say which relationshipType published it or
// what the target is. This probe prints both — every `references` edge whose
// target contains `-`, `.` or `/`, grouped by relationshipType, with the file
// and line of a sample — so the ruling (leaf vs raw vs debris) is read off the
// lane's own output instead of guessed at.
//
// Run: bun script/m14/tmp/go-799-reftargets.ts <repoRoot> [limit]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const root = process.argv[2]
const limit = Number(process.argv[3] ?? 400)
const files: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 16) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith(".go")) files.push(p)
  }
}
walk(root)
files.sort()
const chosen = files.slice(0, limit)

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

type Row = { rt: string; sep: string; count: number; samples: string[] }
const rows = new Map<string, Row>()
let scanned = 0
let errors = 0
let edges = 0

for (const f of chosen) {
  const src = fs.readFileSync(f, "utf8")
  let res: any
  try {
    const tree: any = parser.parse(src)
    const st = [tree.rootNode]
    let hasError = false
    while (st.length) {
      const n: any = st.pop()
      if (n.type === "ERROR" || n.isMissing) { hasError = true; break }
      for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
    }
    if (hasError) errors++
    res = await analyzer.analyze(tree.rootNode, src, f)
  } catch (e) {
    console.log(`  ANALYZER THREW on ${f}: ${(e as Error).message}`)
    continue
  }
  scanned++
  for (const r of (res.relationships ?? []) as any[]) {
    const rel = String(r.type ?? "")
    if (rel !== "references") continue
    edges++
    const target = String(r.target ?? "")
    const sep = target.includes("/") ? "/" : target.includes(".") ? "." : target.includes("-") ? "-" : undefined
    if (!sep) continue
    const rt = String(r.metadata?.relationshipType ?? "(none)")
    const key = `${rt}|${sep}`
    const row = rows.get(key) ?? { rt, sep, count: 0, samples: [] }
    row.count++
    if (row.samples.length < 5) {
      const ln = Number(r.line_number ?? 0)
      const lineText = ln > 0 ? src.split("\n")[ln - 1]?.trim().slice(0, 60) : "?"
      const metaKeys = Object.keys(r.metadata ?? {}).join(",")
      row.samples.push(
        `${JSON.stringify(target)} src=${String(r.source)} @ ${path.relative(root, f)}:${r.line_number ?? "?"} meta=[${metaKeys}] line=${JSON.stringify(lineText)}`,
      )
    }
    rows.set(key, row)
  }
}

console.log(`=== files=${scanned} (of ${files.length}) with-parse-error=${errors} references-edges=${edges}`)
console.log(`=== references targets carrying a separator, by relationshipType ===`)
const sorted = [...rows.values()].sort((a, b) => b.count - a.count)
for (const row of sorted) {
  console.log(`  ${row.rt.padEnd(22)} sep=${row.sep}  count=${row.count}`)
  for (const s of row.samples) console.log(`      ${s}`)
}
if (sorted.length === 0) console.log("  (none)")

// For contrast: the same census over EVERY label, so a fix to `references` can
// be checked against the whole published surface at once.
const byLabel = new Map<string, number>()
for (const f of chosen) {
  const src = fs.readFileSync(f, "utf8")
  const tree: any = parser.parse(src)
  const res: any = await analyzer.analyze(tree.rootNode, src, f)
  for (const r of (res.relationships ?? []) as any[]) {
    const target = String(r.target ?? "")
    if (!/[-./]/.test(target)) continue
    const key = `${String(r.type ?? "")}|${target.includes("/") ? "/" : target.includes(".") ? "." : "-"}`
    byLabel.set(key, (byLabel.get(key) ?? 0) + 1)
  }
}
console.log(`=== every label with a separator in its target (same draw) ===`)
for (const [k, v] of [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k}  ${v}`)

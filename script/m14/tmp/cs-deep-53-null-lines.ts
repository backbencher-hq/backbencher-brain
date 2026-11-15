// Which `contains` rows carry no line, and what are they? 61 of 2492 is 2.4% — small, but a
// null line is a hole in a field every other relationship fills, and the shape of the hole is the
// question. If they are all one construct, it is a fixable gap; if they are scattered, it is
// something structural.
import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const files = fs.readFileSync("/home/sano/ishaq/bb_tests/lists/roslyn-src.txt", "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 200)
const rows: string[] = []
const byTarget = new Map<string, number>()
let n = 0
for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 1_000_000) continue
  let res: any
  try { res = await ASTEngine.parseFile(f, src) } catch { continue }
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType)
    if (t !== "contains") continue
    if (r.line_number !== null && r.line_number !== undefined) continue
    n++
    const key = String(r.target).replace(/[0-9]+$/, "#")
    byTarget.set(key, (byTarget.get(key) ?? 0) + 1)
    if (rows.length < 14) rows.push(`  ${path.basename(f)}  ${r.source} -> ${r.target}  meta=${JSON.stringify(r.metadata ?? {}).slice(0, 80)}`)
  }
}
console.log(`  null-line \`contains\` rows: ${n}`)
for (const r of rows) console.log(r)
console.log(`\n  by target shape (trailing digits collapsed):`)
for (const [k, v] of [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(v).padStart(4)}  ${k}`)

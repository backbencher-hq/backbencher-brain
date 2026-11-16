// Is the class-A residue a whole-file line shift, or per-node?
// Prints, for one file: the analyzer's function symbols with their claimed line
// and the source text at that line, then a few uses/calls rows the same way.
//
// Usage: bun script/m14/tmp/c912-offby.ts <file> [startLine] [endLine]
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const abs = process.argv[2]
const from = Number(process.argv[3] ?? 1)
const to = Number(process.argv[4] ?? 100)
const src = readFileSync(abs, "utf8")
const lines = src.split("\n")
const res: any = await parseFile(abs, src, { language: "cpp" })

console.log(`file: ${abs}  (${lines.length} lines)`)
console.log("\n=== function symbols in window ===")
for (const s of res.symbols ?? []) {
  const l = s?.range?.startLine
  if (typeof l !== "number" || l < from || l > to) continue
  if (!["function", "method", "constructor"].includes(String(s.kind))) continue
  console.log(`  claimed=${String(l).padStart(5)}  ${String(s.kind).padEnd(12)} ${s.name}`)
  console.log(`      ${String(l).padStart(5)}| ${(lines[l - 1] ?? "").trim().slice(0, 90)}`)
}
console.log("\n=== uses/calls rows in window ===")
for (const r of res.relationships ?? []) {
  const l = r?.line_number
  if (typeof l !== "number" || l < from || l > to) continue
  if (!["uses", "calls", "references"].includes(String(r.type))) continue
  console.log(`  claimed=${String(l).padStart(5)}  ${String(r.type).padEnd(10)} ${r.source} -> ${r.target}`)
  console.log(`      ${String(l).padStart(5)}| ${(lines[l - 1] ?? "").trim().slice(0, 90)}`)
  const name = String(r.target ?? "")
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(^|[^\\w])${esc}([^\\w]|$)`)
  for (let i = Math.max(0, l - 2); i < Math.min(lines.length, l + 3); i++) {
    if (i + 1 !== l && re.test(lines[i])) console.log(`      name written at ${i + 1}| ${lines[i].trim().slice(0, 80)}`)
  }
}

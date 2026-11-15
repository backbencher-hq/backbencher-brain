// #919: sample the file-scope symbols the analyzer publishes inside a
// macro-declared body span, and the reads it sources at `global` there.
//   bun script/m14/tmp/c919-sample.ts <file> <line>
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const file = process.argv[2]
const line = Number(process.argv[3])
const src = readFileSync(file, "utf8")
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const res: any = await parseFile(file, src, { language: "cpp" })
const spans = (res.symbols ?? []).filter((s: any) => s.range?.startLine >= line && s.range?.startLine <= line + 90)
console.log(`file=${path.basename(file)} line=${line} symbols=${res.symbols?.length} rels=${res.relationships?.length}`)
console.log("\nsymbols in the window (90 lines):")
for (const s of spans.slice(0, 30)) {
  console.log(`  ${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""} scope=${JSON.stringify(s.scope)} vis=${s.visibility ?? "-"} meta=${JSON.stringify(s.metadata ?? null).slice(0, 80)}`)
}
const rels = (res.relationships ?? []).filter((r: any) => r.line_number >= line && r.line_number <= line + 90)
const owners = new Map<string, number>()
for (const r of rels) owners.set(String(r.source), (owners.get(String(r.source)) ?? 0) + 1)
console.log(`\nrelationships in the window: ${rels.length}`)
console.log(`sources: ${[...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(", ")}`)
console.log("\nlines:")
const lines = src.split("\n")
for (let i = line; i < Math.min(line + 12, lines.length); i++) console.log(`  ${i + 1}: ${lines[i]}`)

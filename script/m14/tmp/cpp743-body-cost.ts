// #743c: the cost, through the PRODUCTION entry. For a macro-call heading followed by
// a block (`TEST(Suite, name) { … }`), print what the analyzer publishes inside the
// body: symbols declared there, and reads it sources at `global` — the #917 evidence
// shape (locals leaking as file-scope names, body reads attributed to nothing).
//   bun script/m14/tmp/cpp743-body-cost.ts <file> <line>
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const file = process.argv[2]
const line = Number(process.argv[3])
const src = readFileSync(file, "utf8")
const res: any = await parseFile(file, src, { language: "cpp" })
const lines = src.split("\n")
const near = (r: any) => r?.startLine >= line && r?.startLine <= line + 60
// relationships carry `line_number`, symbols carry `range.startLine`
console.log(`file=${path.basename(file)}:${line}  symbols=${res.symbols?.length} rels=${res.relationships?.length}`)
console.log(`\nheading: ${lines[line - 1]?.trim().slice(0, 90)}`)
const bodies = (res.symbols ?? []).filter(near)
console.log(`\nsymbols declared inside the next 60 lines (${bodies.length}):`)
for (const s of bodies.slice(0, 14)) console.log(`   ${s.range?.startLine}:${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}  scope=${s.scope}`)
const rels = (res.relationships ?? []).filter((r: any) => r?.line_number >= line && r?.line_number <= line + 60)
const atGlobal = rels.filter((r: any) => r.source === "global")
console.log(`\nrelationships starting in that window: ${rels.length} — sourced at \`global\`: ${atGlobal.length}`)
for (const r of atGlobal.slice(0, 12)) console.log(`   ${r.line_number}:${r.type}: global -> ${r.target}`)
const owners = new Map<string, number>()
for (const r of rels) owners.set(String(r.source), (owners.get(String(r.source)) ?? 0) + 1)
console.log(`\nsources in the window: ${[...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(", ")}`)

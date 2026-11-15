import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const file = "/home/ishaq2321/bb_tests/repositories/jq/src/builtin.c"
const src = readFileSync(file, "utf8")
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await parseFile(file, src, { language: "c" } as any)
const syms = (res.symbols ?? []).filter((s: any) => s.name === "gen_last_1")
for (const s of syms) console.log("SYMBOL", JSON.stringify({ kind: s.kind, name: s.name, visibility: s.visibility, scope: s.scope, line: s.range?.startLine, meta: s.metadata }, null, 0))
const rels = (res.relationships ?? []).filter((r: any) => r.line_number >= 2065 && r.line_number <= 2069)
for (const r of rels.slice(0, 6)) console.log("REL", JSON.stringify({ t: r.type, s: r.source, g: r.target, line: r.line_number, meta: r.metadata }, null, 0))
console.log("--- truth-side probe: does truth derive a call edge here? ---")

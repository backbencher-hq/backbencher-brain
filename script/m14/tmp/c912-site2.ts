// #912 part 1: the site's analyzer output through the PRODUCTION entry.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const file = "/home/ishaq2321/bb_tests/repositories/jq/src/builtin.c"
const src = readFileSync(file, "utf8")
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await parseFile(file, src, { language: "c" } as any)
const from = 2055, to = 2095
const syms = (res.symbols ?? []).filter((s: any) => (s.range?.startLine ?? 0) >= from && (s.range?.startLine ?? 0) <= to)
console.log(`symbols in window ${from}..${to}: ${syms.length}`)
for (const s of syms.slice(0, 30)) console.log(`  ${s.kind} ${s.name} @${s.range?.startLine} owner=${s.ownerName ?? "-"} export=${s.isExported ?? s.isExport ?? "-"}`)
const rels = (res.relationships ?? []).filter((r: any) => r.line_number >= from && r.line_number <= to)
console.log(`relationships in window: ${rels.length}`)
for (const r of rels.slice(0, 20)) console.log(`  ${r.type} ${r.source} -> ${r.target} @${r.line_number}`)
console.log("gen_last_1 published?", (res.symbols ?? []).some((s: any) => s.name === "gen_last_1"))
console.log("function-scoped symbols named last_var/is_empty_var/init:",
  (res.symbols ?? []).filter((s: any) => ["last_var","is_empty_var","init"].includes(s.name)).map((s: any) => `${s.name}@${s.range?.startLine}:${s.kind}:owner=${s.ownerName ?? "-"}`).join(" | ") || "(none)")

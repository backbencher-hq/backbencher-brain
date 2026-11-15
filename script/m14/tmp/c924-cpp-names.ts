// #924 cpp row: which published cpp targets contain whitespace, and what are they?
// Runs the PRODUCTION entry (parseFile) on the two files the census names.
import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/engine"
const FILES = [
  "/home/ishaq2321/bb_tests/repositories/fmt/include/fmt/args.h",
  "/home/ishaq2321/bb_tests/repositories/fmt/include/fmt/base.h",
]
for (const f of FILES) {
  const r: any = await parseFile(f, readFileSync(f, "utf8"))
  const arr = [r.analysis ?? r]
  for (const L of arr) {
    if (!L || !L.relationships) { console.log("   shape:", Object.keys(r)); continue }
    const edges = L.relationships ?? []
    const ws = edges.filter((e: any) => /\s/.test(String(e.target)))
    console.log(`\n== ${f.split("/").pop()} edges=${edges.length} whitespaceTargets=${ws.length}`)
    const byType: Record<string, number> = {}
    for (const e of ws) byType[e.type] = (byType[e.type] ?? 0) + 1
    console.log("   by type:", JSON.stringify(byType))
    for (const e of ws.slice(0, 8)) console.log(`   - [${e.type}] ${JSON.stringify(e.target)} line=${e.line ?? e.lineStart}`)
  }
}

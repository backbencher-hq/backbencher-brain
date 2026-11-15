// CONTAINS SHAPE PROBE — what does a `contains` edge actually connect?
//
// WHY. The lane census reports `contains` firing (5,400 edges over 1,526 corpus files,
// 5,183 resolving to exactly one declaration) but the `memberKind` histogram is only
// `property` (4,886) and `constant` (514) — table->column and table->index. A schema
// containing a table is the most obvious containment in SQL, and it does not appear in
// that histogram. The histogram alone cannot say whether the edge is ABSENT or merely
// unlabelled, so this probe prints every `contains` edge with the KIND of each endpoint,
// read from the file's own symbol table.
//
// USAGE: bun validation/m14/fixtures/sql/contains-shape-probe.ts <file.sql> [...]
import { readFileSync } from "node:fs"
import { getParser } from "../../../../src/ast/engine.ts"

const m: any = await import("../../../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

const shapes = new Map<string, number>()
let total = 0
for (const f of process.argv.slice(2)) {
  const content = readFileSync(f, "utf8")
  const parser = await getParser("sql")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  const kind = new Map<string, string>()
  for (const s of res.symbols || []) kind.set(s.name, String(s.kind))
  const rels = (res.relationships || []).filter((r: any) => (r.type ?? r.relationshipType) === "contains")
  console.log(`\n=== ${f}   contains=${rels.length}`)
  for (const r of rels) {
    const sk = String(kind.get(r.source) ?? "?")
    const tk = String(kind.get(r.target) ?? "?")
    const mk = (r.metadata ?? {}).memberKind ?? "-"
    console.log(`  ${sk}:${r.source}  ->  ${tk}:${r.target}   memberKind=${mk}`)
    shapes.set(`${sk} -> ${tk}`, (shapes.get(`${sk} -> ${tk}`) || 0) + 1)
    total++
  }
  const kinds: Record<string, number> = {}
  for (const s of res.symbols || []) kinds[String(s.kind)] = (kinds[String(s.kind)] || 0) + 1
  console.log("  symbol kinds:", JSON.stringify(kinds))
}
console.log(`\nCONTAINS SHAPES (sourceKind -> targetKind) over ${total} edge(s):`)
for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${v}`)

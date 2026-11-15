// Dart M60 retrofit: trace DT-wave payload through emit -> store -> query.
// Real pipeline (indexProjectParallel) into a throwaway BB_DATA_DIR (M59
// pattern), then read the landed rows back. Writes M60 evidence, never
// touches M59's files or the user index.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "dt-seam-"))
process.env.BB_DATA_DIR = EMPTY

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/dt-seam"

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const pid = getProjectId(REPO) as any
  const stats = await indexProjectParallel(pid, REPO, {})
  console.log(`indexed: files=${stats.totalFiles} symbols=${stats.totalSymbols} rels=${stats.totalRelationships} errors=${stats.errorFiles}`)

  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  const one = (sql: string) => raw.prepare(sql).get() as any

  console.log("\n=== relationship rows by type ===")
  for (const r of q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship GROUP BY rt ORDER BY n DESC`))
    console.log(`  ${String(r.rt).padEnd(16)} ${r.n}`)

  console.log("\n=== line_number distribution (all rows) ===")
  console.log("  >0:", one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number > 0`).c,
    "| =0:", one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0`).c,
    "| NULL:", one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL`).c)

  console.log("\n=== DT uses rows: metadata preserved? ===")
  for (const r of q(`SELECT relationship_type rt, target_external te, line_number ln, substr(metadata, 1, 160) md FROM brain_relationship WHERE relationship_type = 'uses' LIMIT 12`))
    console.log(`  uses->${r.te} line=${r.ln} meta=${r.md}`)

  console.log("\n=== DT instantiates rows (named/super/this) ===")
  for (const r of q(`SELECT target_external te, line_number ln, substr(metadata, 1, 160) md FROM brain_relationship WHERE relationship_type = 'instantiates' LIMIT 12`))
    console.log(`  inst->${r.te} line=${r.ln} meta=${r.md}`)

  console.log("\n=== symbols: ranges + comments landing? ===")
  const sym = one(`SELECT COUNT(*) c FROM brain_symbol`)
  const withRange = one(`SELECT COUNT(*) c FROM brain_symbol WHERE start_line IS NOT NULL AND start_line > 0`)
  console.log(`  symbols=${sym.c} with start_line>0: ${withRange.c}`)
  for (const r of q(`SELECT name, kind, substr(comments, 1, 80) cm FROM brain_symbol WHERE comments IS NOT NULL AND comments != '' LIMIT 5`))
    console.log(`  sym ${r.kind}:${r.name} comments=${r.cm}`)

  // query side: what does the graph engine hand the tools for these edges?
  const { GraphEngine } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
  const g = new (GraphEngine as any)(pid)
  const usesRow = q(`SELECT id FROM brain_relationship WHERE relationship_type = 'uses' LIMIT 1`)[0]
  console.log("\n=== sample uses row id:", usesRow?.id ?? "NONE")
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

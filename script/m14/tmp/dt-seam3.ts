import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "dt-seam3-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/dt-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const cols = (raw.prepare(`PRAGMA table_info(brain_symbol)`).all() as any[]).map((c: any) => c.name)
  console.log("symbol cols:", cols.join(","))
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  console.log("\n=== dart symbols landing ===")
  for (const r of q(`SELECT name, symbol_type, line_start, line_end, substr(docstring,1,40) ds, substr(parameters,1,60) pm, visibility FROM brain_symbol LIMIT 8`))
    console.log(`  ${r.symbol_type}:${r.name} lines=${r.line_start}-${r.line_end} vis=${r.visibility} doc=${r.ds} params=${r.pm}`)
  const withDoc = (raw.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE docstring IS NOT NULL AND docstring != ''`).get() as any).c
  const total = (raw.prepare(`SELECT COUNT(*) c FROM brain_symbol`).get() as any).c
  console.log(`  symbols with docstring: ${withDoc}/${total}`)
  const withParams = (raw.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE parameters IS NOT NULL AND parameters != '' AND parameters != '[]'`).get() as any).c
  console.log(`  symbols with parameters: ${withParams}/${total}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

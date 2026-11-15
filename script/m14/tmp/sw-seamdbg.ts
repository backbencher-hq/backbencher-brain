import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "sw-seamdbg-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/sw-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  console.log("=== line_number = 0 rows ===")
  for (const r of q(`SELECT id, relationship_type rt, source_external se, target_external te, confidence, substr(metadata,1,120) md FROM brain_relationship WHERE line_number = 0`))
    console.log(`  ${r.rt} srcExt=${r.se} tgtExt=${r.te} conf=${r.confidence} meta=${r.md}`)
  console.log("=== duplicate groups ===")
  for (const r of q(`SELECT relationship_type rt, source_symbol_id s, target_external te, COUNT(*) n, GROUP_CONCAT(id, '|') ids FROM brain_relationship GROUP BY rt, s, te HAVING n > 1`))
    console.log(`  ${r.rt} [${r.te}] x${r.n}: ${String(r.ids).slice(0, 120)}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

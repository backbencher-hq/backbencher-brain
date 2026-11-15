import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "oc-seamdbg-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/oc-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  console.log("=== line>0 by type ===")
  for (const r of q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE line_number > 0 GROUP BY rt`))
    console.log(`  ${r.rt}: ${r.n}`)
  console.log("=== sample ===")
  for (const r of q(`SELECT relationship_type rt, target_external te, line_number ln, substr(metadata,1,100) md FROM brain_relationship WHERE line_number > 0 LIMIT 4`))
    console.log(`  ${r.rt}->${r.te} line=${r.ln} meta=${r.md}`)
  console.log("=== evidenceClass keepers ===")
  for (const r of q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE json_extract(metadata, '$.evidenceClass') IS NOT NULL GROUP BY rt`))
    console.log(`  ${r.rt}: ${r.n}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

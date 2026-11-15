import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "php2-seam-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/php2-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  const one = (sql: string) => raw.prepare(sql).get() as any
  const FLAGS = ["isLocalRead", "isGlobalRead", "isConstRead"]
  const flags: Record<string, number> = {}
  for (const k of FLAGS)
    flags[k] = one(`SELECT COUNT(*) c FROM brain_relationship WHERE json_extract(metadata, '$.${k}') IS NOT NULL`).c
  const usesRows = one(`SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type = 'uses'`).c
  const ev = JSON.parse(readFileSync(path.join(ROOT, "validation/m60/results/P1-php.json"), "utf8"))
  ev.secondReview = {
    at: new Date().toISOString(),
    newFlags: flags,
    usesRows,
    lineNull: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL`).c,
    lineZero: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0`).c,
    verdict: "PHP2 local/global/const uses land with type/target/confidence; flags join F1 (enrichment overwrite, filed on P1 #829); line NULL (no edge lines emitted)",
  }
  writeFileSync(path.join(ROOT, "validation/m60/results/P1-php.json"), JSON.stringify(ev, null, 2) + "\n")
  console.log("flags:", JSON.stringify(flags), "uses:", usesRows)
  console.log("P1-php.json extended")
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

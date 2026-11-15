import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "dt-seam2-"))
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
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  console.log("=== FULL metadata of 3 uses rows ===")
  for (const r of q(`SELECT target_external te, confidence, metadata FROM brain_relationship WHERE relationship_type = 'uses' LIMIT 3`)) {
    console.log(`uses->${r.te} conf=${r.confidence}`)
    console.log("  meta keys:", Object.keys(JSON.parse(r.metadata ?? "{}")).join(","))
  }
  console.log("\n=== FULL metadata of 2 instantiates rows ===")
  for (const r of q(`SELECT target_external te, confidence, metadata FROM brain_relationship WHERE relationship_type = 'instantiates' LIMIT 2`)) {
    console.log(`inst->${r.te} conf=${r.confidence}`)
    console.log("  meta keys:", Object.keys(JSON.parse(r.metadata ?? "{}")).join(","))
  }
  console.log("\n=== evidenceClass survival ===")
  for (const r of q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship WHERE json_extract(metadata, '$.evidenceClass') IS NOT NULL GROUP BY rt`))
    console.log(`  ${r.rt}: ${r.n} rows keep evidenceClass`)
  console.log("\n=== analyzer flags survival (isMemberRead/isNamedConstructor/isMixin/isFieldRead) ===")
  for (const k of ["isMemberRead", "isNamedConstructor", "isMixin", "isFieldRead", "isSubscriptBase", "isInterpolationRead", "isSuperConstructor"]) {
    const n = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE json_extract(metadata, '$.${k}') IS NOT NULL`).get() as any).c
    console.log(`  ${k}: ${n}`)
  }
  console.log("\n=== symbols: comments + ranges ===")
  const s = q(`SELECT name, kind, start_line, comments FROM brain_symbol LIMIT 4`)
  for (const r of s) console.log(`  ${r.kind}:${r.name} line=${r.start_line} comments=${JSON.stringify(r.comments)?.slice(0, 60)}`)
  const nc = (raw.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE comments IS NOT NULL AND comments != '' AND comments != '[]'`).get() as any).c
  console.log(`  symbols with non-empty comments: ${nc}`)
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })

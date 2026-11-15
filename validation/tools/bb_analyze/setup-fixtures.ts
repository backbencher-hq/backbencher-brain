// Phase A fixture builder for bb_analyze.
// Indexes T0 (test/fixtures/polyglot) and T1 (.perf-fixtures/bb-scale/n100) into a
// tool-local data dir so no shared index (.bb-data) is touched.
// Run: BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata npx tsx validation/tools/bb_analyze/setup-fixtures.ts
import path from "node:path"
import { existsSync } from "node:fs"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DATA = process.env.BB_DATA_DIR
if (!DATA) throw new Error("BB_DATA_DIR must be set (tool-local bbdata dir)")

const TIERS = [
  { tier: "T0", dir: path.join(ROOT, "test/fixtures/polyglot") },
  { tier: "T1", dir: path.join(ROOT, ".perf-fixtures/bb-scale/n100") },
]

const out: Record<string, unknown> = { dataDir: DATA, tiers: [] as unknown[] }
for (const { tier, dir } of TIERS) {
  if (!existsSync(dir)) throw new Error(`${tier} fixture missing: ${dir}`)
  const projectId = getProjectId(dir)
  const t0 = Date.now()
  await indexProjectParallel(projectId, dir, {})
  const ms = Date.now() - t0
  const raw = await BrainDatabase.getRawInstance(projectId)
  const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c
  const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(projectId) as any).c
  ;(out.tiers as unknown[]).push({ tier, dir, projectId, files, symbols, relationships: rels, indexMs: ms })
  console.log(`${tier} ${dir}: files=${files} symbols=${symbols} rels=${rels} in ${ms}ms`)
}
console.log(JSON.stringify(out, null, 2))

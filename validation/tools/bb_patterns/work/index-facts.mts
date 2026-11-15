// Phase A index-facts probe: records what population a tier's index actually
// holds (files/symbols/relationships/frameworks) plus its db mtime, through a
// byte-read-only open so the measurement cannot move the index.
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx index-facts.mts <tier> <projectDir> <out.json>

import { statSync, existsSync } from "node:fs"
import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

const tier = process.argv[2]
const projectDir = process.argv[3]
const outPath = process.argv[4]
if (!tier || !projectDir || !outPath) { console.error("usage: index-facts.mts <tier> <projectDir> <out.json>"); process.exit(2) }

const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
function count(sql: string): number | string {
  try { return ((raw.prepare(sql).get(projectId) as any)?.c as number) ?? 0 } catch (e: any) { return `error:${e?.message ?? e}` }
}
const facts = {
  tier,
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default)",
  dbPath,
  exists: existsSync(dbPath),
  index: {
    files: count("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?"),
    symbols: count("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?"),
    relationships: count("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?"),
    frameworkFiles: count("SELECT COUNT(*) c FROM brain_file WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown')"),
    analysisRuns: count("SELECT COUNT(*) c FROM brain_analysis_run WHERE project_id = ?"),
  },
  dbBefore: before,
  dbAfter: { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(facts, null, 2) + "\n")
console.log(JSON.stringify(facts, null, 1))

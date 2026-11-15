// Prepare a measurement copy after a migration: checkpoint the migration WAL and refresh
// planner statistics, then record both costs separately from the tool measurement. A read
// measurement must not pay for a 229 MB migration WAL it would never face on a settled
// index, and the planner must see the new indexes' statistics.
import { writeFileSync, statSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
const [projectDir, outPath] = process.argv.slice(2)
if (!projectDir || !outPath) { console.error("usage: prepare-copy.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (statSync(p).bytes)
const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
const raw: any = await BrainDatabase.getRawInstance(projectId)
const t0 = performance.now()
raw.exec("PRAGMA wal_checkpoint(TRUNCATE)")
const checkpointMs = Math.round((performance.now() - t0) * 100) / 100
const t1 = performance.now()
raw.exec("ANALYZE")
const analyzeMs = Math.round((performance.now() - t1) * 100) / 100
const stats = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sqlite_stat%'").all() as any[]
BrainDatabase.closeAll()
const after = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
const report = { projectDir, before, after, checkpointMs, analyzeMs, statsTables: stats.map((s) => s.name), generatedAt: new Date().toISOString() }
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report))

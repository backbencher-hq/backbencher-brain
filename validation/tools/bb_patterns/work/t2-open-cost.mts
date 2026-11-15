// Phase A T2 open-cost probe: times the read path's database OPEN separately from
// its query work, byte-read-only vs the default read-write open. The read-write
// open runs the additive migrations/healers (and possibly ANALYZE) on a fresh
// process; a read tool must not pay that, and must not write the index to read it.
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx t2-open-cost.mts <projectDir> <out.json>

import { statSync, existsSync, writeFileSync } from "node:fs"
import { loadavg } from "node:os"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) { console.error("usage: t2-open-cost.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
const loadAtStart = loadavg()

const tRo = performance.now()
const ro = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const readonlyOpenMs = Math.round((performance.now() - tRo) * 100) / 100
const tRoQ = performance.now()
const roCount = (ro.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c
const readonlyQueryMs = Math.round((performance.now() - tRoQ) * 100) / 100
const afterReadonly = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
BrainDatabase.closeAll()

const tRw = performance.now()
const rw = await BrainDatabase.getRawInstance(projectId)
const readWriteOpenMs = Math.round((performance.now() - tRw) * 100) / 100
const tRwQ = performance.now()
const rwCount = (rw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c
const readWriteQueryMs = Math.round((performance.now() - tRwQ) * 100) / 100
const afterReadWrite = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
BrainDatabase.closeAll()
const afterClose = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }

const report = {
  projectId,
  dbPath,
  dataDir: process.env.BB_DATA_DIR ?? null,
  loadAtStart,
  openCost: {
    readonlyOpenMs,
    readonlyQueryMs,
    readWriteOpenMs,
    readWriteQueryMs,
    deltaOpenMs: Math.round((readWriteOpenMs - readonlyOpenMs) * 100) / 100,
  },
  symbolCounts: { readonly: roCount, readWrite: rwCount },
  files: { before, afterReadonly, afterReadWrite, afterClose },
  indexWriteFromReadWriteOpen: JSON.stringify(before) !== JSON.stringify(afterReadWrite),
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))

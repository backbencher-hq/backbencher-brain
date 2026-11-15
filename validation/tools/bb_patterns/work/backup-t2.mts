// Phase A T2 evidence: takes a consistent SQLite backup of the reference index
// through a byte-read-only source handle, so latency and page-size measurements
// run against a copy the current read-write path may touch without risk to the
// shared index. Source db/wal are stat'ed before and after to prove the backup
// itself changed nothing.
//
// Usage: BB_DATA_DIR=.bb-data npx tsx backup-t2.mts <sourceProjectId> <destDir> <out.json>

import { mkdirSync, writeFileSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"

const sourceProjectId = process.argv[2]
const destDir = process.argv[3]
const outPath = process.argv[4]
if (!sourceProjectId || !destDir || !outPath) {
  console.error("usage: backup-t2.mts <sourceProjectId> <destDir> <out.json>")
  process.exit(2)
}
const sourceDb = BrainDatabase.getDbPath(sourceProjectId)
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const before = { db: statOf(sourceDb), wal: statOf(`${sourceDb}-wal`), shm: statOf(`${sourceDb}-shm`) }
const destDb = path.join(destDir, "projects", sourceProjectId, "brain.db")
mkdirSync(path.dirname(destDb), { recursive: true })
const t0 = performance.now()
const raw = await BrainDatabase.getRawInstance(sourceProjectId, { readonly: true })
await (raw as any).native.backup(destDb)
const backupMs = Math.round(performance.now() - t0)
const after = { db: statOf(sourceDb), wal: statOf(`${sourceDb}-wal`), shm: statOf(`${sourceDb}-shm`) }
const report = {
  sourceDb,
  destDb,
  sourceProjectId,
  backupMs,
  copiedBytes: statOf(destDb)?.bytes ?? null,
  sourceBefore: before,
  sourceAfter: after,
  sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
  runWith: { BB_DATA_DIR: destDir },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))

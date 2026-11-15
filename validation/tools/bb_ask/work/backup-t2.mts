// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — takes a consistent SQLite backup of a large index through a byte-read-only
//   source handle, so end-to-end bb_ask latency can be measured on a copy that the tool's
//   read-write handle may touch without any risk to the shared index. The source db/wal are
//   stat'ed before and after to prove the backup itself changed nothing.
// WHICH TOOL IT SERVES — bb_ask (read), T2 tier measurement.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/LATENCY.json, validation/tools/bb_ask/t2-copy/ (gitignored).
// EDIT TOGETHER WHEN THIS CHANGES — work/latency.mts.
//
// Usage: BB_DATA_DIR=<source data dir> npx tsx backup-t2.mts <sourceProjectId> <destDir> <out.json>

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
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null)
const before = { db: statOf(sourceDb), wal: statOf(`${sourceDb}-wal`) }
const destDb = path.join(destDir, "projects", sourceProjectId, "brain.db")
mkdirSync(path.dirname(destDb), { recursive: true })
const t0 = performance.now()
const raw = await BrainDatabase.getRawInstance(sourceProjectId, { readonly: true })
await (raw as any).native.backup(destDb)
const backupMs = Math.round(performance.now() - t0)
const after = { db: statOf(sourceDb), wal: statOf(`${sourceDb}-wal`) }
const report = {
  sourceDb,
  destDb,
  sourceProjectId,
  backupMs,
  size: statOf(destDb)?.size ?? null,
  sourceFiles: { before, after, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after) },
  destProjectIdForRun: sourceProjectId,
  runWith: { BB_DATA_DIR: destDir, projectDir: path.resolve(".") },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))

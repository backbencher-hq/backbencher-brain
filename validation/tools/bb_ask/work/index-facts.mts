// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — records the index facts a bb_ask measurement must state (file/symbol/
//   relationship/embedding counts, model labels, db+wal sizes and mtimes) and proves the open
//   was byte-read-only by re-stating the same facts after the read.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/*.json.
// EDIT TOGETHER WHEN THIS CHANGES — work/t2-components.mts, work/latency.mts.
//
// Usage: BB_DATA_DIR=<dir> npx tsx index-facts.mts <projectDir> <out.json>

import { statSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) {
  console.error("usage: index-facts.mts <projectDir> <out.json>")
  process.exit(2)
}

const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)

function fileStat(p: string) {
  if (!existsSync(p)) return null
  const s = statSync(p)
  return { path: p, size: s.size, mtimeMs: s.mtimeMs, mtime: new Date(s.mtimeMs).toISOString() }
}

const before = { db: fileStat(dbPath), wal: fileStat(`${dbPath}-wal`), shm: fileStat(`${dbPath}-shm`) }

const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const one = (sql: string) => (raw.prepare(sql).get(projectId) as any)?.c ?? -1
const counts = {
  files: one("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?"),
  symbols: one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?"),
  relationships: one("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?"),
  imports: one("SELECT COUNT(*) c FROM brain_import WHERE project_id = ?"),
  embeddingRows: one("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ?"),
  embeddedEntities: one("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id = ?"),
}
const models = raw
  .prepare(
    "SELECT embedding_model AS model, vector_dimension AS dimension, COUNT(*) AS rows " +
      "FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model, vector_dimension ORDER BY rows DESC",
  )
  .all(projectId) as Array<{ model: string; dimension: number; rows: number }>
// A read handle must be able to report its own mode; the lock state proves nothing by itself.
const handleReadonly = (raw as any).readonly === true

const after = { db: fileStat(dbPath), wal: fileStat(`${dbPath}-wal`), shm: fileStat(`${dbPath}-shm`) }
// A byte-read-only read must not change the database BYTES and must not add WAL frames.
// SQLite creates an empty -wal and a -shm alongside any WAL-mode connection (read-only
// included); a 0-byte WAL is the absence of uncommitted frames, not a write.
const dbUnchanged = before.db?.size === after.db?.size && before.db?.mtimeMs === after.db?.mtimeMs
const walContentChanged = (before.wal?.size ?? 0) !== (after.wal?.size ?? 0)
const unchanged = dbUnchanged && !walContentChanged

const report = {
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  dbPath,
  dbReadonlyHandle: handleReadonly,
  counts,
  embeddingModels: models,
  files: { before, after, dbUnchanged, walContentChanged, dbUnchangedNote: "db bytes unchanged AND no WAL frames added; a newly present 0-byte -wal and a touched -shm are connection artifacts, not writes" },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))

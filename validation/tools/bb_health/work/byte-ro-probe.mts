// Byte-level write-on-read probe for the plain bb_health path.
// Hashes brain.db and brain.db-wal (bytes) before/after one default call; the
// -shm file is reported separately because it is SQLite's shared-memory
// coordination file and a read-only reader joining the shm may update read
// marks — the index itself must not move.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const root = mkdtempSync(path.join(tmpdir(), "bb-health-bytero-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function alpha(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function beta(): number { return alpha() }\n")
await indexProjectParallel(projectId as any, root, {})
const dbDir = path.dirname(BrainDatabase.getDbPath(projectId))
const h = (f: string) => existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16) : "absent"
const snap = () => {
  const files = readdirSync(dbDir).sort()
  return {
    db: h(path.join(dbDir, "brain.db")),
    wal: h(path.join(dbDir, "brain.db-wal")),
    dbStat: existsSync(path.join(dbDir, "brain.db")) ? `${statSync(path.join(dbDir, "brain.db")).size}:${statSync(path.join(dbDir, "brain.db")).mtimeMs}` : "absent",
    walStat: existsSync(path.join(dbDir, "brain.db-wal")) ? `${statSync(path.join(dbDir, "brain.db-wal")).size}:${statSync(path.join(dbDir, "brain.db-wal")).mtimeMs}` : "absent",
    shmStat: existsSync(path.join(dbDir, "brain.db-shm")) ? `${statSync(path.join(dbDir, "brain.db-shm")).size}:${statSync(path.join(dbDir, "brain.db-shm")).mtimeMs}` : "absent",
    files,
  }
}
const before = snap()
const report = await getUnifiedHealth(projectId, root, {})
const after = snap()
console.log(JSON.stringify({
  dbUnchanged: before.db === after.db && before.dbStat === after.dbStat,
  walUnchanged: before.wal === after.wal && before.walStat === after.walStat,
  shmMayMove: before.shmStat !== after.shmStat,
  before, after, counts: report.counts,
}, null, 2))

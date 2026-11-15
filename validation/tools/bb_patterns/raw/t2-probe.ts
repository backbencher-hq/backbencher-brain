// Phase A evidence probe: records the T2 reference index identity (files, symbols,
// relationships, db/WAL bytes and mtimes) through a byte-read-only open so the
// measurement itself cannot move the index.
import { statSync, existsSync } from "node:fs"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"

const root = process.cwd()
const pid = getProjectId(root)
const dbPath = BrainDatabase.getDbPath(pid)
function statOf(p: string) {
  return existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null
}
const before = { db: statOf(dbPath), wal: statOf(dbPath + "-wal"), shm: statOf(dbPath + "-shm") }
const raw = await BrainDatabase.getRawInstance(pid, { readonly: true })
function count(sql: string): number | string {
  try { return (raw.prepare(sql).get(pid) as any)?.c ?? 0 } catch (e: any) { return `error:${e?.message ?? e}` }
}
const payload = {
  projectId: pid,
  dbPath,
  dbBefore: before,
  counts: {
    files: count("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?"),
    symbols: count("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?"),
    relationships: count("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?"),
    frameworks: count("SELECT COUNT(*) c FROM brain_file WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown')"),
  },
  sqliteVersion: (() => { try { return (raw.prepare("SELECT sqlite_version() v").get() as any)?.v } catch { return "unknown" } })(),
  measuredAt: new Date().toISOString(),
}
const after = { db: statOf(dbPath), wal: statOf(dbPath + "-wal"), shm: statOf(dbPath + "-shm") }
const out = { ...payload, dbAfter: after, dbUnchanged: JSON.stringify(before) === JSON.stringify(after) }
console.log(JSON.stringify(out, null, 2))

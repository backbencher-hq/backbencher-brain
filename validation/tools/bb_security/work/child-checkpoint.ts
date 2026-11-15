// Normalise a project database to a checkpointed baseline using the driver
// directly (no BrainDatabase, no migrations, no healer): the WAL is flushed
// into brain.db and truncated, so a later read-path probe starts from a stable
// byte image and every difference is attributable to that probe.
import Database from "better-sqlite3"

const dbPath = process.argv[2]!
const db = new Database(dbPath)
try {
  const before = (db.prepare("PRAGMA journal_mode").get() as any)?.journal_mode
  const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()
  console.log(JSON.stringify({ dbPath, journalMode: before, checkpoint }))
} finally {
  db.close()
}

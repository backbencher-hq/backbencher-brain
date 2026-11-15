// validation/tools/bb_cross_language/work/copy-t2-db.cjs
//
// Copy the shared reference index into this tool's validation tree so the HANDLER
// can be measured end to end without opening the shared store read-write. Uses the
// SQLite backup API from a READ-ONLY source connection, so the copy is a consistent
// snapshot even while the fleet writes; the source is never modified.
//
// Run: node validation/tools/bb_cross_language/work/copy-t2-db.cjs
const Database = require("better-sqlite3")
const { mkdirSync, statSync } = require("node:fs")
const { join } = require("node:path")

const PID = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const SRC = join(".bb-data", "projects", PID, "brain.db")
const DEST_DIR = join("validation", "tools", "bb_cross_language", "t2-copy", "projects", PID)
const DEST = join(DEST_DIR, "brain.db")

mkdirSync(DEST_DIR, { recursive: true })
const src = new Database(SRC, { readonly: true, fileMustExist: true })
const started = Date.now()
src.backup(DEST).then((pages) => {
  const counts = (db) => ({
    files: db.prepare("SELECT COUNT(*) n FROM brain_file").get().n,
    symbols: db.prepare("SELECT COUNT(*) n FROM brain_symbol").get().n,
    relationships: db.prepare("SELECT COUNT(*) n FROM brain_relationship").get().n,
    crossLanguageRows: db.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE is_cross_language = 1").get().n,
  })
  const sourceCounts = counts(src)
  src.close()
  const copy = new Database(DEST, { readonly: true, fileMustExist: true })
  const copyCounts = counts(copy)
  copy.close()
  const equal = JSON.stringify(sourceCounts) === JSON.stringify(copyCounts)
  const out = {
    source: SRC,
    destination: DEST,
    bytes: statSync(DEST).size,
    pages,
    copyMs: Date.now() - started,
    sourceCounts,
    copyCounts,
    equal,
    note: "read-only source, SQLite backup API; the handler measures against this copy with a private BB_DATA_DIR",
  }
  require("node:fs").writeFileSync(join("validation", "tools", "bb_cross_language", "results", "t2-copy.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
  process.exit(equal ? 0 : 1)
}).catch((error) => { console.error(error); process.exit(1) })

// validation/tools/bb_annotations/work/copy-t2-db.cjs
//
// Copies the shared reference index into this lane's validation tree so the
// handler can be measured end to end WITHOUT opening the shared store
// read-write (the current read door does open read-write, so measuring it
// against .bb-data would move the fleet's store). The copy is taken with the
// SQLite backup API from a READ-ONLY source connection, so it is a consistent
// snapshot even while the fleet writes, and the source is never modified.
//
// Run: node validation/tools/bb_annotations/work/copy-t2-db.cjs
const Database = require("better-sqlite3")
const { mkdirSync, statSync, writeFileSync, existsSync } = require("node:fs")
const { join } = require("node:path")
const { createHash } = require("node:crypto")

const ROOT = join(__dirname, "..", "..", "..", "..")
const PID = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const SRC_DIR = join(ROOT, ".bb-data", "projects", PID)
const SRC = join(SRC_DIR, "brain.db")
const DEST_DIR = join(ROOT, "validation", "tools", "bb_annotations", "t2-copy", "projects", PID)
const DEST = join(DEST_DIR, "brain.db")
// The reference db is larger than 2 GiB, so the digest is streamed rather than
// read into one buffer (readFileSync refuses a 3.6 GB file).
const sha = (file) => {
  if (!existsSync(file)) return null
  const hash = createHash("sha256")
  const fd = require("node:fs").openSync(file, "r")
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytes
    while ((bytes = require("node:fs").readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
  } finally {
    require("node:fs").closeSync(fd)
  }
  return hash.digest("hex")
}

mkdirSync(DEST_DIR, { recursive: true })
const sourceStat = {
  dbBytes: statSync(SRC).size,
  dbMtimeMs: statSync(SRC).mtimeMs,
  walBytes: existsSync(SRC + "-wal") ? statSync(SRC + "-wal").size : null,
  walMtimeMs: existsSync(SRC + "-wal") ? statSync(SRC + "-wal").mtimeMs : null,
  dbSha256: sha(SRC),
}
const src = new Database(SRC, { readonly: true, fileMustExist: true })
const started = Date.now()
const counts = (db) => ({
  files: db.prepare("SELECT COUNT(*) n FROM brain_file").get().n,
  symbols: db.prepare("SELECT COUNT(*) n FROM brain_symbol").get().n,
  relationships: db.prepare("SELECT COUNT(*) n FROM brain_relationship").get().n,
  annotations: db.prepare("SELECT COUNT(*) n FROM brain_annotation").get().n,
})
src.backup(DEST).then((pages) => {
  const sourceCounts = counts(src)
  src.close()
  const copy = new Database(DEST, { readonly: true, fileMustExist: true })
  const copyCounts = counts(copy)
  copy.close()
  const out = {
    schemaVersion: 1,
    tool: "bb_annotations",
    purpose: "T2 reference-large-index handler measurements against a byte copy (shared store is never opened read-write)",
    source: { path: SRC, ...sourceStat },
    destination: DEST,
    destinationBytes: statSync(DEST).size,
    pages,
    copyMs: Date.now() - started,
    sourceCounts,
    copyCounts,
    equal: JSON.stringify(sourceCounts) === JSON.stringify(copyCounts),
    copiedAt: new Date().toISOString(),
    note: "read-only source connection + SQLite backup API; the copy is what every T2 measurement opens",
  }
  writeFileSync(join(ROOT, "validation", "tools", "bb_annotations", "raw", "t2-copy.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
  process.exit(out.equal ? 0 : 1)
}).catch((error) => { console.error(error); process.exit(1) })

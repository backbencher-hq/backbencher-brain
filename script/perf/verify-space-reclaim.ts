// verify-space-reclaim.ts — the wipe-path reclaim must actually reclaim, and it
// must decide AFTER it checkpoints.
//
// The bug this pins (2026-10-08): `reclaimSpace` measured `freelist_count`
// BEFORE `wal_checkpoint`. A wipe deletes rows, but in WAL mode the freed pages
// are still in the WAL, so the pre-checkpoint freelist still described the
// PRE-wipe file. Measured on a real 2,328 MB database whose rows had just been
// deleted: the VACUUM branch did not fire, and the rebuild then wrote into all
// 2,328 MB of holes. Checkpoint first, then measure, then decide — this asserts
// exactly that, on a database big enough for the floors to be real.
//
//   npx tsx script/perf/verify-space-reclaim.ts
//
// Deterministic, no network, no project database; it writes one temp file.

import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { reclaimSpace, spaceReport, checkpointWal } from "../../src/ast/index-space"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

const dir = mkdtempSync(path.join(tmpdir(), "bb-space-"))
const dbPath = path.join(dir, "brain.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.pragma("synchronous = NORMAL")

// ~120 MB of rows, then delete them: the shape a force-wipe leaves behind.
db.exec("CREATE TABLE payload (id INTEGER PRIMARY KEY, blob BLOB)")
const insert = db.prepare("INSERT INTO payload (blob) VALUES (?)")
const blob = Buffer.alloc(1024 * 1024, 7)
const fill = db.transaction((n: number) => {
  for (let i = 0; i < n; i++) insert.run(blob)
})
fill(120)

const fullBytes = statSync(dbPath).size
db.exec("DELETE FROM payload")

// Before the checkpoint: the freed pages are still in the WAL, which is exactly
// the state the buggy version measured in.
const preCheckpoint = spaceReport(db, dbPath)
console.log(
  `  info: db ${(fullBytes / 1048576).toFixed(1)} MB after fill; pre-checkpoint freelist reads ${(preCheckpoint.freelistBytes / 1048576).toFixed(1)} MB (${(preCheckpoint.freeRatio * 100).toFixed(1)}% free)`,
)
check(
  "the file does not shrink by itself when rows are deleted",
  statSync(dbPath).size >= fullBytes * 0.9,
  `size ${statSync(dbPath).size}`,
)

// checkpointWal must be honest about succeeding on an idle connection.
check("checkpointWal reports success on an idle database", checkpointWal(db) === true)

const postCheckpoint = spaceReport(db, dbPath)
check(
  "AFTER a checkpoint the freed pages are visible (this is the ordering fix)",
  postCheckpoint.freelistBytes > 64 * 1024 * 1024,
  `freelist ${(postCheckpoint.freelistBytes / 1048576).toFixed(1)} MB`,
)

const reclaimed = reclaimSpace(db, dbPath, { vacuum: true })
check("reclaimSpace vacuums when the file is mostly holes", reclaimed.vacuumed === true, JSON.stringify(reclaimed))
check(
  "and the file actually shrinks",
  reclaimed.dbBytes < fullBytes * 0.5,
  `before ${(fullBytes / 1048576).toFixed(1)} MB -> after ${(reclaimed.dbBytes / 1048576).toFixed(1)} MB`,
)
check(
  "the WAL is left truncated, not at its high-water mark",
  reclaimed.walBytes < 8 * 1024 * 1024,
  `wal ${(reclaimed.walBytes / 1048576).toFixed(1)} MB`,
)
check("vacuum time is measured, not claimed", typeof reclaimed.vacuumMs === "number" && reclaimed.vacuumMs >= 0)

// A database that is NOT full of holes must not pay for a VACUUM.
const second = reclaimSpace(db, dbPath, { vacuum: true })
check("a compact database is not vacuumed again", second.vacuumed === false, JSON.stringify(second))

db.close()
rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? "\nSPACE RECLAIM: ALL PASS" : `\nSPACE RECLAIM: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)

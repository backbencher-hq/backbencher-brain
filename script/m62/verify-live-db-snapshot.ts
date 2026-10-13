#!/usr/bin/env tsx
// script/m62/verify-live-db-snapshot.ts — the third instance of one defect class.
//
// THE CLASS. Every brain.db is opened in WAL mode
// (src/storage/db.node.ts: `db.pragma("journal_mode = WAL")`). In WAL mode the
// committed rows live in the `-wal` sidecar until a checkpoint, and the main file
// on disk is not the database. Anything that copies, snapshots, or restores that
// file through the FILESYSTEM gets a partial database — usually a 4,096-byte
// SQLite header with zero tables — and will happily write that back over a
// working index.
//
// THREE INSTANCES, all found and fixed:
//   1. src/ast/project-registry.ts          `bb index --import` copyFileSync'd a
//                                            live brain.db, then re-keyed the
//                                            header and reported success with an
//                                            empty index. Fixed with
//                                            wal_checkpoint(TRUNCATE).
//   2. script/m23/verify-p3-edge-cases.ts    the FIXTURE made the identical
//                                            mistake, so the gate tested a file it
//                                            had emptied itself. Fixed likewise.
//   3. script/m25/e5-inner.js                `readFileSync(brainDbPath)` snapshotted
//                                            a live brain.db for restore, and the
//                                            `finally` wrote the bare header back
//                                            over the editor's index. Fixed with
//                                            VACUUM INTO, and the restore now
//                                            removes -wal/-shm first, because a
//                                            stale WAL replays over a restored
//                                            main file on the next open.
//
// This gate is the net. It drives the real indexer, then proves the two ways of
// taking a copy differ by exactly the thing that matters, and fails if any source
// file goes back to the filesystem method.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const u = (rel: string) => pathToFileURL(path.join(ROOT, rel)).href

const base = path.join("/tmp", "bb-snapshot-gate-" + process.pid)
rmSync(base, { recursive: true, force: true })
process.env.BB_DATA_DIR = base

const { BrainDatabase } = (await import(u("src/brain/database.ts"))) as any
const { indexProjectParallel } = (await import(u("src/ast/parallel-indexer.ts"))) as any
const { getProjectId } = (await import(u("src/util/project-id.ts"))) as any
const { default: Database } = (await import("better-sqlite3")) as any

function hasBrainFile(dbPath: string): { has: boolean; rows: number } {
  try {
    const c = new Database(dbPath, { readonly: true })
    try {
      const t = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_file'").get()
      if (!t) return { has: false, rows: 0 }
      return { has: true, rows: Number((c.prepare("SELECT COUNT(*) n FROM brain_file").get() as any).n) }
    } finally {
      c.close()
    }
  } catch {
    return { has: false, rows: 0 }
  }
}

try {
  const proj = path.join(base, "proj")
  mkdirSync(proj, { recursive: true })
  writeFileSync(
    path.join(proj, "main.ts"),
    'export function greet(): string {\n  return "hi"\n}\n',
    "utf8",
  )

  const pid = getProjectId(proj)
  await indexProjectParallel(pid, proj, { onProgress: () => {}, skipPostProcessing: true })
  const dbPath: string = BrainDatabase.getDbPath(pid)

  // --- the precondition: the database is genuinely WAL, and open ------------
  const walSize = existsSync(dbPath + "-wal") ? statSync(dbPath + "-wal").size : 0
  check(
    "the index leaves an UNCHECKPOINTED -wal, which is what makes this bug possible",
    walSize > 0,
    `brain.db=${statSync(dbPath).size}B  -wal=${walSize}B`,
  )
  const live = hasBrainFile(dbPath)
  check("the live database really has the row", live.has && live.rows > 0, `brain_file=${live.has} rows=${live.rows}`)

  // --- the defect, reproduced ----------------------------------------------
  const fsCopy = path.join(base, "fs-copy.db")
  writeFileSync(fsCopy, readFileSync(dbPath))
  const fsResult = hasBrainFile(fsCopy)
  check(
    "the FILESYSTEM copy of a live brain.db is INCOMPLETE (the defect, reproduced)",
    !fsResult.has || fsResult.rows === 0,
    `fs copy: ${fsResult.rows} row(s), brain_file=${fsResult.has} — this is why every copy must go through SQLite`,
  )

  // --- the fix, proven on the same database ---------------------------------
  const dest = path.join(base, "vacuum.db")
  const h = new Database(dbPath, { readonly: true })
  try {
    h.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  } finally {
    h.close()
  }
  const vacResult = hasBrainFile(dest)
  check(
    "VACUUM INTO copies a live WAL database COMPLETELY (the fix)",
    vacResult.has && vacResult.rows === live.rows,
    `vacuum copy: ${vacResult.rows} row(s), brain_file=${vacResult.has} (live has ${live.rows})`,
  )
  check(
    "the two methods really do differ (the gate is comparing something)",
    fsResult.rows !== vacResult.rows,
    `filesystem=${fsResult.rows} rows vs VACUUM INTO=${vacResult.rows} rows`,
  )

  // --- checkpoint, the other sanctioned fix, also works ----------------------
  const cpDest = path.join(base, "checkpoint.db")
  const w = new Database(dbPath)
  try {
    w.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    w.close()
  }
  const cpFile = path.join(base, "after-checkpoint.db")
  writeFileSync(cpFile, readFileSync(dbPath))
  const cpResult = hasBrainFile(cpFile)
  check(
    "wal_checkpoint(TRUNCATE) also makes the filesystem copy complete",
    cpResult.has && cpResult.rows === live.rows,
    `after checkpoint: ${cpResult.rows} row(s)`,
  )

  // --- and no source has gone back to copying through the filesystem --------
  {
    // The two sanctioned methods. A file that copies a live brain.db by reading
    // it is repeating the defect, so the gate names any file that does.
    // CODE ONLY. The first version of this check matched raw text and flagged
    // script/m25/e5-inner.js — on the COMMENT that documents this very defect,
    // which quotes `readFileSync(brainDbPath)` while explaining why it must not be
    // used. A comment cannot be evaluated, so it cannot be the defect. This reuses
    // script/m62/path_encoding_scan.ts, which already blanks comments and strings
    // while preserving line numbers, rather than growing a second scanner here.
    const { blankCommentsAndStrings } = await import("./path_encoding_scan.ts")
    const SUSPECT = /readFileSync\(\s*[A-Za-z_$][\w$.]*[Dd]b[A-Za-z_$\.]*\s*\)/g
    // Walk the WORKING TREE, not `git ls-files`. Found by testing this gate with a
    // planted defect: the plant was untracked, `git ls-files` never listed it, and
    // the gate reported PASS over a file that contained the exact defect it exists
    // to catch. That is the worst possible gap — it exempts every file that has not
    // been `git add`ed yet, which is precisely when a new defect is being written.
    const { walkSourceFiles } = await import("./path_encoding_scan.ts")
    const roots = ["src", "script", "ide"].map((d) => path.join(ROOT, d))
    const files = roots.flatMap((r) => walkSourceFiles(r)).map((f) => path.relative(ROOT, f))
    const offenders: string[] = []
    for (const f of files) {
      const raw = readFileSync(path.join(ROOT, f), "utf8")
      // Two scans, two different inputs, and getting this wrong silently disabled
      // the check. The PATTERN runs over blanked code (a comment must not match).
      // The CONTEXT runs over the RAW text, because the context is a STRING literal
      // — `const brainDb = "/tmp/.../brain.db"` — and blanking strings erases it.
      // Scanned the other way round, a planted defect passed the gate: its
      // executable readFileSync was found, then the guard could not see the
      // "brain.db" that would have made it count.
      if (!SUSPECT.test(blankCommentsAndStrings(raw))) continue
      if (/brain\.db|getDbPath|bbProjectsDir/.test(raw)) offenders.push(f)
    }
    check(
      "no source snapshots a live brain.db through the filesystem",
      offenders.length === 0,
      offenders.length === 0
        ? `${files.length} working-tree source file(s) scanned`
        : `*** ${offenders.length} still do: ${offenders.join(", ")} ***`,
    )
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nLIVE DB SNAPSHOT: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)
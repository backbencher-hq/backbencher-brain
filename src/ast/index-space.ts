/**
 * index-space.ts — the WAL and the free pages that nothing in bb ever reclaimed.
 *
 * MEASURED on this repository, 2026-10-08, after one full index and one forced
 * rebuild of ~944k symbols:
 *
 *     brain.db       8,084,680,704 bytes   (8.08 GB)
 *     brain.db-wal     766,344,752 bytes   (766 MB)
 *
 * `bb_health` reported the WAL itself, correctly, as a cost: "WAL file is 730.8 MB
 * (DB is 6888.9 MB). Large WAL files slow down read queries." No code path in bb
 * ever ran `wal_checkpoint`, so the WAL is the sum of everything written since the
 * file was created, and a forced rebuild wipes rows IN PLACE — by design, so a live
 * MCP server's handle is never orphaned — which leaves the same 8 GB file with
 * almost all of its pages free. Every subsequent insert then allocates pages from a
 * fragmented 8 GB file instead of a compact one.
 *
 * This module is the two safe reclaim points, both of them places where the writes
 * have already stopped:
 *   - after a force-wipe, before the rebuild writes anything (checkpoint, and
 *     VACUUM when the file is mostly holes);
 *   - at the end of a run (checkpoint, and report the footprint).
 *
 * It never deletes the database file: keeping the file is what keeps a running
 * MCP server's connection valid, and that property is worth more than the bytes.
 */

import { statSync } from "node:fs"

export interface SpaceReport {
  dbBytes: number
  walBytes: number
  freelistBytes: number
  /** Free pages as a share of the database file, 0..1. */
  freeRatio: number
  checkpointed: boolean
  vacuumed: boolean
  vacuumMs: number | null
}

/**
 * Truncate the WAL, and report whether SQLite ACTUALLY did it.
 *
 * A refused checkpoint does not throw: `PRAGMA wal_checkpoint(TRUNCATE)` returns
 * a row `{busy, log, checkpointed}` and sets `busy: 1` when another connection
 * holds a read snapshot — the normal state of this machine, with a live MCP
 * server attached. The first version of this function discarded that row and
 * returned `true` unconditionally, so `SpaceReport.checkpointed` could claim a
 * checkpoint SQLite had refused. Verified against a concurrent read snapshot:
 * the pragma returns `{busy: 1, log: 3, checkpointed: 3}`, the WAL stays at
 * 12,392 bytes, and only after the reader releases does it return `busy: 0` and
 * truncate to 0.
 */
export function checkpointWal(rawDb: any): boolean {
  try {
    const result = rawDb.pragma("wal_checkpoint(TRUNCATE)")
    const row = Array.isArray(result) ? result[0] : result
    if (row && typeof row === "object" && "busy" in row) return Number(row.busy) === 0
    // A driver that returns no row cannot be asked; the caller still gets the
    // measured WAL size afterwards, which is the number that matters.
    return true
  } catch {
    return false
  }
}

/** Read what the file actually holds. All of this is cheap; none of it scans. */
export function spaceReport(rawDb: any, dbPath: string): SpaceReport {
  let dbBytes = 0
  let walBytes = 0
  try {
    dbBytes = statSync(dbPath).size
  } catch {}
  try {
    walBytes = statSync(`${dbPath}-wal`).size
  } catch {}

  let freelistBytes = 0
  let freeRatio = 0
  try {
    const free = Number((rawDb.pragma("freelist_count", { simple: true }) as number) ?? 0)
    const pageSize = Number((rawDb.pragma("page_size", { simple: true }) as number) ?? 0)
    freelistBytes = free * pageSize
    freeRatio = dbBytes > 0 ? freelistBytes / dbBytes : 0
  } catch {}

  return { dbBytes, walBytes, freelistBytes, freeRatio, checkpointed: false, vacuumed: false, vacuumMs: null }
}

/**
 * Should a force-wipe vacuum the file it just emptied?
 *
 * NOT decided on `freelist_count`. Measured on the real 3.33 GB project database:
 * immediately after `wipeProjectData` deleted every row, `freelist_count` read 0,
 * so the ratio test did not fire and the rebuild wrote into 3.33 GB of holes — and
 * a later read of the same file showed 347,751 free pages (1,358 MB, 42.8%). The
 * counter lags the deletes until a checkpoint, and a checkpoint can be refused
 * while another connection (a running MCP server) holds a read snapshot.
 *
 * What the wipe path knows WITHOUT asking SQLite: it just deleted `rowsDeleted`
 * rows from a file of `dbBytes`. That is the evidence this decides on.
 */
export function shouldVacuumAfterWipe(input: { rowsDeleted: number; dbBytes: number; minBytes?: number }): boolean {
  const minBytes = input.minBytes ?? 256 * 1024 * 1024
  return input.rowsDeleted > 0 && input.dbBytes >= minBytes
}

export interface ReclaimOptions {
  /**
   * VACUUM when the file is mostly free pages. Only worth it where the file is
   * about to be written again — after a force-wipe — because VACUUM rewrites the
   * whole database and takes an exclusive lock while it does.
   */
  vacuum?: boolean
  /** Free-space share above which vacuuming is worth its cost. */
  vacuumAboveRatio?: number
  /** Free-space floor below which vacuuming is not worth waking up for. */
  vacuumAboveBytes?: number
  log?: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * Checkpoint the WAL, and vacuum only when the file is mostly holes. Returns the
 * measured result rather than a claim about it, so a caller can print what
 * happened and a test can assert it.
 */
export function reclaimSpace(rawDb: any, dbPath: string, opts: ReclaimOptions = {}): SpaceReport {
  // ORDER MATTERS, and the first version had it wrong: it measured the freelist
  // BEFORE checkpointing. In WAL mode the pages a wipe just freed are still in the
  // WAL, so `freelist_count` still described the pre-wipe file — measured on a
  // 2,328 MB file whose rows had just been deleted, the VACUUM branch did not fire
  // and the rebuild wrote into all of it. Checkpoint first, then measure, then
  // decide.
  const checkpointed = checkpointWal(rawDb)
  const before = spaceReport(rawDb, dbPath)

  const ratioFloor = opts.vacuumAboveRatio ?? 0.25
  const byteFloor = opts.vacuumAboveBytes ?? 64 * 1024 * 1024
  const wantVacuum = opts.vacuum === true && before.freelistBytes >= byteFloor && before.freeRatio >= ratioFloor

  let vacuumed = false
  let vacuumMs: number | null = null
  if (wantVacuum && process.env.BB_INDEX_VACUUM !== "0") {
    const started = Date.now()
    try {
      rawDb.exec("VACUUM")
      vacuumed = true
    } catch (e: any) {
      opts.log?.("VACUUM skipped", { error: String(e?.message ?? e) })
    }
    vacuumMs = Date.now() - started
    // VACUUM writes the compacted database THROUGH the WAL, so the file itself
    // does not shrink until the next checkpoint. Without this second checkpoint
    // the report says "vacuumed" beside an unchanged byte count — which is what
    // the first version of this function did, and what
    // script/perf/verify-space-reclaim.ts caught.
    if (vacuumed) checkpointWal(rawDb)
  }

  // Re-read after the rewrite: the point of the exercise is the numbers AFTER.
  const after = spaceReport(rawDb, dbPath)
  return { ...after, checkpointed, vacuumed, vacuumMs }
}

/** One line, in the units a human reads. */
export function formatSpace(report: SpaceReport): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  const parts = [`db ${mb(report.dbBytes)}`, `wal ${mb(report.walBytes)}`]
  // The free share is what the VACUUM decision turns on, so a run states it
  // rather than leaving a reader to wonder why a 2.3 GB file was left alone.
  if (report.freeRatio > 0) parts.push(`${(report.freeRatio * 100).toFixed(0)}% free`)
  if (report.vacuumed && report.vacuumMs !== null) parts.push(`vacuumed in ${(report.vacuumMs / 1000).toFixed(1)}s`)
  return parts.join(", ")
}

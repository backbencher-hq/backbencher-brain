// src/brain/semantic/vector-promote.ts — M50.A2 (#764)
// Lazy blob promotion for legacy rows.
//
// The indexer writes the float32 accelerator at insert time and the
// post-processing `vectorBlobs` phase backfills whole indexes on the next
// index run. Neither helps a user who has an existing index and never re-runs
// it — and "you must re-index to get the fix" is exactly the complaint this
// milestone exists to remove. So: when a semantic read meets rows that are
// readable from JSON but have no blob, it schedules a bounded, non-blocking
// promotion of the rows it just read.
//
// Rules (a read must never become slower, unsafer, or dependent on a write):
//  - the response is never awaited: promotion runs on a timer after the caller
//    has its answer, and the timer is unref'd so it can never hold a CLI
//    process open;
//  - read-only handles never promote (nothing to write through);
//  - one promotion per project+model at a time, bounded to PROMOTE_BATCH rows,
//    so a huge index is completed over several calls instead of one long write;
//  - every failure is swallowed to debug logging: an accelerator that cannot be
//    built must never break a query (the JSON path still answers).

import { encodeVectorBlob, scanJsonVectorInto } from "./vector-binary"

/** Rows promoted per background pass. Bounds write time and memory. */
export const PROMOTE_BATCH = 4000

const inFlight = new Set<string>()

/**
 * Schedule promotion of the given rowids (rows a caller just read).
 * Fire-and-forget by contract: returns immediately, writes later, never throws.
 */
export function promoteMissingBlobsInBackground(
  raw: any,
  projectId: string,
  model: string,
  rowids: number[],
  onDone?: (promoted: number) => void,
): void {
  if (!rawids(rowids) || raw?.readonly === true || !raw?.prepare) return
  const key = `${projectId}:${model}`
  if (inFlight.has(key)) return
  inFlight.add(key)
  const batch = rowids.slice(0, PROMOTE_BATCH)
  const timer = setTimeout(() => {
    let promoted = 0
    try {
      promoted = promoteRows(raw, batch)
    } catch {
      // Accelerator work is best-effort by definition.
      promoted = 0
    } finally {
      inFlight.delete(key)
      try {
        onDone?.(promoted)
      } catch {}
    }
  }, 0)
  // A cache warm-up must never keep a process alive.
  ;(timer as any)?.unref?.()
}

function rawids(rowids: number[]): boolean {
  return Array.isArray(rowids) && rowids.length > 0
}

/** Promote exactly the given rowids; returns how many got a blob. */
export function promoteRows(raw: any, rowids: number[]): number {
  if (rowids.length === 0) return 0
  const select = raw.prepare(
    "SELECT rowid AS rowid, embedding_vector AS vector, vector_dimension AS dim FROM brain_semantic_embedding WHERE rowid = ? AND embedding_blob IS NULL",
  )
  const update = raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = ? WHERE rowid = ?")
  const scratchByDim = new Map<number, Float32Array>()
  const items: Array<{ rowid: number; blob: Buffer }> = []
  for (const rowid of rowids) {
    const row = select.get(rowid) as { rowid: number; vector: string; dim: number } | undefined
    if (!row) continue // already promoted, deleted, or not a dense row
    const dim = Number(row.dim)
    if (!Number.isInteger(dim) || dim <= 0 || dim > 8192) continue
    let scratch = scratchByDim.get(dim)
    if (!scratch) {
      scratch = new Float32Array(dim)
      scratchByDim.set(dim, scratch)
    }
    const n = scanJsonVectorInto(typeof row.vector === "string" ? row.vector : "", scratch)
    if (n !== dim) continue
    items.push({ rowid: row.rowid, blob: encodeVectorBlob(scratch) })
  }
  if (items.length === 0) return 0
  const tx = raw.transaction((batchItems: Array<{ rowid: number; blob: Buffer }>) => {
    for (const it of batchItems) update.run(it.blob, it.rowid)
  })
  tx(items)
  return items.length
}

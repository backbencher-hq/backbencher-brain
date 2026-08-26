// Freshness utility: compare indexed file_hash against the on-disk file so
// read paths can flag stale rows instead of returning confident wrong data.
import { createHash } from "crypto"
import { readFileSync, existsSync, statSync } from "fs"
import type { CoreDatabase } from "../brain/database"

export interface FileFreshness {
  fileId: string
  path: string
  indexedHash: string
  /** file absent, hash identical, or hash differs */
  status: "missing" | "fresh" | "stale"
}

/** SHA-256 (16 hex chars) — must match the indexer's file_hash computation. */
export function hashFileContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/** mtime+size fast path: if both match, the file is fresh without hashing. */
export function fileUnchangedSince(path: string, indexedHash: string, indexedSize?: number | null, indexedMtime?: number | null): boolean {
  try {
    const stat = statSync(path)
    // The indexer records both values from the same stat operation used for
    // discovery. This is the normal read-path fast path: unchanged metadata
    // means the file is fresh without reopening and hashing source content.
    // Hash remains the authoritative fallback when metadata is unavailable or
    // differs, preserving correctness for edited files.
    if (indexedSize !== null && indexedSize !== undefined && indexedMtime !== null && indexedMtime !== undefined &&
      stat.size === indexedSize && Math.floor(stat.mtimeMs) === Math.floor(indexedMtime)) return true
    const content = readFileSync(path)
    return hashFileContent(content) === indexedHash
  } catch {
    return false
  }
}

/**
 * Check one indexed file for freshness. Returns the status without throwing.
 */
export function checkFileFreshness(raw: CoreDatabase, fileId: string): FileFreshness | null {
  try {
    const row = raw
      .prepare("SELECT path, file_hash, size_bytes, last_modified FROM brain_file WHERE id = ?")
      .get(fileId) as { path: string; file_hash: string; size_bytes?: number | null; last_modified?: number | null } | undefined
    if (!row) return null
    if (!existsSync(row.path)) return { fileId, path: row.path, indexedHash: row.file_hash, status: "missing" }
    const fresh = fileUnchangedSince(row.path, row.file_hash, row.size_bytes, row.last_modified)
    return { fileId, path: row.path, indexedHash: row.file_hash, status: fresh ? "fresh" : "stale" }
  } catch {
    return null
  }
}

/**
 * Batch freshness check for the files behind a set of results. Returns a map
 * fileId -> status. Files checked once even when many symbols share the file.
 */
export function checkResultsFreshness(
  raw: CoreDatabase,
  rows: Array<{ fileId?: string }>,
): Map<string, "fresh" | "stale" | "missing"> {
  const result = new Map<string, "fresh" | "stale" | "missing">()
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.fileId || seen.has(r.fileId)) continue
    seen.add(r.fileId)
    const f = checkFileFreshness(raw, r.fileId)
    if (f) result.set(r.fileId, f.status)
  }
  return result
}

/** Convenience for a single symbol id: look up its file and check freshness. */
export function checkSymbolFreshness(raw: CoreDatabase, symbolId: string): FileFreshness | null {
  try {
    const row = raw
      .prepare("SELECT file_id FROM brain_symbol WHERE id = ?")
      .get(symbolId) as { file_id: string } | undefined
    if (!row) return null
    return checkFileFreshness(raw, row.file_id)
  } catch {
    return null
  }
}

export function statSizeMtime(path: string): { size: number; mtime: number } | null {
  try {
    const s = statSync(path)
    return { size: s.size, mtime: s.mtimeMs }
  } catch {
    return null
  }
}
